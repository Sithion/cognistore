import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { createDbClient, CurationRepository, KnowledgeRepository } from '@cognistore/core';
import { SERVER_ENTRY, authFetch, getFreePort, spawnSidecar, startMockOllama, stopSidecar, waitForSidecar, TEST_TOKEN } from '../sidecar-helpers.js';

// Round 10 (4.2/4.3/4.4 backend): overview, batch, restore, state file and db-health through the
// REAL sidecar. Sandboxed HOME, loopback mock Ollama, no real model.
let home: string, base: string, child: ChildProcess, readLog: () => string;
let mock: Awaited<ReturnType<typeof startMockOllama>>;
let connection: ReturnType<typeof createDbClient>;
let repo: KnowledgeRepository, curation: CurationRepository;
const vec = [1, ...Array(255).fill(0)];
const post = (path: string, body?: unknown) => authFetch(`${base}${path}`, body === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const statePath = () => join(home, '.cognistore', 'curation-state.json');
const readState = () => JSON.parse(readFileSync(statePath(), 'utf8')) as { pending: number; scopes: Record<string, number>; updatedAt: string };
async function waitState(predicate: (s: ReturnType<typeof readState>) => boolean) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { try { if (predicate(readState())) return readState(); } catch { /* not written yet */ } await new Promise(r => setTimeout(r, 50)); }
  throw new Error(`state file did not reach the expected value: ${existsSync(statePath()) ? readFileSync(statePath(), 'utf8') : 'missing'}`);
}
async function entry(title: string) {
  return (await repo.create({ title, content: `${title} content`, type: 'pattern', scope: 'workspace:r10', source: 'test', tags: [], embedding: vec } as never) as unknown as { id: string }).id;
}
function propose(kind: string, ids: string[]) {
  const rows = ids.map(id => curation.getEntry(id));
  const versions = Object.fromEntries(rows.map(r => [r.id, { version: r.version, contentHash: r.content_hash, scope: r.scope, status: r.status }]));
  return curation.createAction({ id: randomUUID(), kind, actor: 'curation', entryIds: ids, snapshot: curation.captureSnapshot(ids), confidence: 0.9, payload: { reason: 'test' },
    versions, key: `${kind}:${ids.join(',')}:${randomUUID()}`, now: new Date().toISOString(), undoExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }).id as string;
}
const status = (id: string) => (curation.getEntry(id) as { status: string }).status;

test.describe.configure({ mode: 'serial', timeout: 90_000 });
test.beforeEach(async () => {
  test.skip(!existsSync(SERVER_ENTRY), 'Built sidecar required');
  home = mkdtempSync(join(tmpdir(), 'curation-ui-api-r10-'));
  mkdirSync(join(home, '.cognistore'));
  mock = await startMockOllama('nomic-embed-text');
  const port = await getFreePort();
  base = `http://127.0.0.1:${port}`;
  ({ child, readLog } = spawnSidecar({
    HOME: home, COGNISTORE_HOME: join(home, '.cognistore'), SQLITE_PATH: join(home, 'knowledge.db'),
    DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN,
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text',
  }));
  expect(await waitForSidecar(base), readLog()).toBe(true);
  connection = createDbClient(join(home, 'knowledge.db'));
  repo = new KnowledgeRepository(connection.db, connection.sqlite);
  curation = new CurationRepository(connection.sqlite);
});
test.afterEach(async () => {
  try { connection.sqlite.close(); } catch { /* closed */ }
  await stopSidecar(child);
  await new Promise<void>(r => mock.server.close(() => r()));
  rmSync(home, { recursive: true, force: true });
});

test('db-health reports size, bounded table counts, telemetry share and event-loop lag', async () => {
  await entry('health entry');
  const response = await authFetch(`${base}/api/system/db-health`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sizeBytes).toBeGreaterThan(0);
  expect(body.tables.find((t: { name: string }) => t.name === 'knowledge_entries').rows).toBeGreaterThanOrEqual(1);
  expect(body.telemetryShare).toBeGreaterThanOrEqual(0);
  expect(body.telemetryShare).toBeLessThanOrEqual(1);
  expect(body.lastVacuumAt === null || typeof body.lastVacuumAt === 'string').toBe(true);
  expect(Object.keys(body.eventLoopLagMs).sort()).toEqual(['max', 'p50', 'p99']);
});

test('overview lists pending count, applied with undo expiry, trash and autonomy', async () => {
  const empty = await (await authFetch(`${base}/api/curation/overview`)).json();
  expect(empty).toMatchObject({ lastRun: null, pending: 0, applied: [], trash: { count: 0, items: [] }, autonomy: 'suggest' });
  const [a, b] = [await entry('overview a'), await entry('overview b')];
  const appliedId = propose('trash', [a]);
  propose('trash', [b]);
  expect((await post(`/api/curation/actions/${appliedId}/apply`)).status).toBe(200);
  const body = await (await authFetch(`${base}/api/curation/overview`)).json();
  expect(body.pending).toBe(1);
  expect(body.applied).toHaveLength(1);
  expect(body.applied[0]).toMatchObject({ id: appliedId, kind: 'trash', status: 'applied', actor: 'curation' });
  expect(Date.parse(body.applied[0].undoExpiresAt)).toBeGreaterThan(Date.now());
  expect(body.trash.count).toBe(1);
  expect(body.trash.items[0]).toMatchObject({ id: a, title: 'overview a' });
  expect(Date.parse(body.trash.items[0].expiresAt)).toBeGreaterThan(Date.parse(body.trash.items[0].trashedAt));
});

test('batch applies sequentially, never aborts on one failure and validates its body', async () => {
  const [a, b, c] = [await entry('batch a'), await entry('batch b'), await entry('batch c')];
  const [x, y, z] = [propose('trash', [a]), propose('trash', [b]), propose('trash', [c])];
  connection.sqlite.prepare('UPDATE knowledge_entries SET version = version + 1 WHERE id = ?').run(c); // z is now stale
  const missing = randomUUID();
  const response = await post('/api/curation/batch', { operation: 'apply', ids: [x, z, missing, y] });
  expect(response.status).toBe(200);
  expect((await response.json()).results).toEqual([
    { id: x, ok: true }, { id: z, ok: false, error: 'stale' }, { id: missing, ok: false, error: 'not_found' }, { id: y, ok: true },
  ]);
  expect([status(a), status(b), status(c)]).toEqual(['trashed', 'trashed', 'active']);
  for (const bad of [{}, { operation: 'delete', ids: [x] }, { operation: 'apply', ids: [] }, { operation: 'apply', ids: ['nope'] },
    { operation: 'apply', ids: [x], extra: 1 }, { operation: 'apply', ids: Array.from({ length: 51 }, () => randomUUID()) }]) {
    expect((await post('/api/curation/batch', bad)).status, JSON.stringify(bad).slice(0, 60)).toBe(400);
  }
});

test('batch reject marks proposals rejected without touching the entries', async () => {
  const a = await entry('reject a');
  const x = propose('trash', [a]);
  const result = await (await post('/api/curation/batch', { operation: 'reject', ids: [x] })).json();
  expect(result.results).toEqual([{ id: x, ok: true }]);
  expect(status(a)).toBe('active');
  expect((connection.sqlite.prepare('SELECT status FROM curation_actions WHERE id=?').get(x) as { status: string }).status).toBe('rejected');
});

test('restore answers 404/409/200 and undoes the trashing action', async () => {
  const [a, b] = [await entry('restore a'), await entry('restore b')];
  const x = propose('trash', [a]);
  expect((await post(`/api/curation/entries/${randomUUID()}/restore`)).status).toBe(404);
  expect((await post(`/api/curation/entries/${b}/restore`)).status).toBe(409);       // not trashed
  expect((await post(`/api/curation/entries/${a}/restore`)).status).toBe(409);       // active, not trashed yet
  expect((await post(`/api/curation/actions/${x}/apply`)).status).toBe(200);
  expect(status(a)).toBe('trashed');
  expect((await post('/api/curation/entries/not-a-uuid/restore')).status).toBe(400);
  const restored = await post(`/api/curation/entries/${a}/restore`);
  expect(restored.status).toBe(200);
  expect(await restored.json()).toEqual({ restored: true, entryId: a, actionId: x });
  expect(status(a)).toBe('active');
  expect((await post(`/api/curation/entries/${a}/restore`)).status).toBe(409);       // already restored
});

test('curation-state.json is written only when the counts change', async () => {
  const ids = [await entry('state a'), await entry('state b'), await entry('state c')];
  const actions = ids.map(id => propose('trash', [id]));
  expect((await post('/api/curation/batch', { operation: 'reject', ids: [actions[0]] })).status).toBe(200);
  const first = await waitState(s => s.pending === 2);
  expect(first.scopes).toEqual({ 'workspace:r10': 2 });
  await new Promise(r => setTimeout(r, 30));
  expect((await post('/api/curation/batch', { operation: 'reject', ids: [randomUUID()] })).status).toBe(200); // no change
  await new Promise(r => setTimeout(r, 300));
  expect(readState().updatedAt).toBe(first.updatedAt);
  expect((await post('/api/curation/batch', { operation: 'reject', ids: [actions[1]] })).status).toBe(200);
  const second = await waitState(s => s.pending === 1);
  expect(second.updatedAt).not.toBe(first.updatedAt);
});
