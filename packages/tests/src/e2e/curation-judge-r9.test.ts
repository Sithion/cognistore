import { test, expect } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDbClient, KnowledgeRepository } from '@cognistore/core';
import { KnowledgeType } from '@cognistore/shared';
import {
  SERVER_ENTRY, TEST_TOKEN, authFetch, getFreePort, spawnSidecar, startMockOllama,
  stopSidecar, waitForSidecar,
} from '../sidecar-helpers.js';
import { MCP_ENTRY, bundleLaunch, callJson, connectMcp } from '../mcp-helpers.js';

type Records = { taskKind: string; candidateIds: string[]; entries: { id: string; title: string; scope: string }[] };
type Answer = (records: Records) => unknown;
let home: string, base: string, host: string, child: ChildProcess | undefined, mock: Server;
let connection: ReturnType<typeof createDbClient>;
let children: ChildProcess[];
let answer: Answer, transport: 'ok' | '500' | 'hang', requests: any[], installed: string[], pulls: number;
const vector = [1, ...Array(255).fill(0)];
const valid = (r: Records, verdict = r.taskKind === 'cluster' ? 'duplicate' : 'still_valid') => ({
  verdict, confidence: 0.99, reason: 'Synthetic evidence', candidateIds: r.candidateIds,
});

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.beforeEach(async () => {
  test.skip(!existsSync(SERVER_ENTRY) || !existsSync(MCP_ENTRY), 'Built sidecar/MCP required; no source substitute');
  children = [];
  home = mkdtempSync(join(tmpdir(), 'curation-judge-r9-'));
  mkdirSync(join(home, '.cognistore'));
  connection = createDbClient(join(home, '.cognistore', 'knowledge.db'));
  answer = r => valid(r); transport = 'ok'; requests = []; pulls = 0;
  installed = ['nomic-embed-text', 'llama3.2:3b'];
  const started = await startMockOllama('nomic-embed-text');
  mock = started.server;
  // Keep the shared helper's embeddings/pull behavior and add deterministic chat.
  const defaults = mock.listeners('request');
  mock.removeAllListeners('request');
  mock.on('request', async (req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify({ models: installed.map(name => ({ name })) }));
    }
    if (req.url !== '/api/chat') {
      if (req.url === '/api/pull') pulls++;
      for (const handler of defaults) handler.call(mock, req, res);
      return;
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const records = JSON.parse(body.messages[1].content.replace(/^<records>|<\/records>$/g, '')) as Records;
    requests.push({ ...body, records });
    if (transport === 'hang') return; // Closed by the sidecar's real abort signal.
    if (transport === '500') return void res.writeHead(500).end('{}');
    const result = answer(records);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: { content: typeof result === 'string' ? result : JSON.stringify(result) } }));
  });
  host = `http://127.0.0.1:${started.port}`;
  await boot();
});
test.afterEach(async () => {
  for (const process of children ?? []) await stopSidecar(process);
  child = undefined;
  connection?.sqlite.close();
  if (mock?.listening) { mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve())); }
  // This directory was created by this fixture and contains only synthetic data.
  if (home) rmSync(home, { recursive: true, force: true });
});
async function boot() {
  const port = await getFreePort(); base = `http://127.0.0.1:${port}`;
  const started = spawnSidecar({ HOME: home, COGNISTORE_HOME: join(home, '.cognistore'),
    SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'), OLLAMA_HOST: host,
    OLLAMA_MODEL: 'nomic-embed-text', DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN });
  child = started.child; children.push(child);
  expect(await waitForSidecar(base), started.readLog()).toBe(true);
  // Health readiness precedes asynchronous workflow seeding/hash backfill.
  await expect.poll(() => connection.sqlite.prepare(
    "SELECT count(*) AS total FROM knowledge_entries WHERE type='system' AND content_hash IS NOT NULL",
  ).get()).toMatchObject({ total: 1 });
}
async function api(method: string, path: string, body?: unknown) {
  const response = await authFetch(`${base}/api/curation${path}`, { method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
async function settings(body: unknown) {
  const response = await authFetch(`${base}/api/settings`, { method: 'PUT',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
}
async function add(title: string, scope: string, old = false) {
  const entry = await new KnowledgeRepository(connection.db, connection.sqlite).create({ title,
    content: `Synthetic evidence for ${title}`, scope: `workspace:judge-${scope}`,
    tags: [], type: old ? KnowledgeType.GOTCHA : KnowledgeType.PATTERN, source: 'synthetic-r9', embedding: vector });
  if (old) connection.sqlite.prepare("UPDATE knowledge_entries SET created_at='2000-01-01',updated_at='2000-01-01',last_read_at=NULL,read_count=0 WHERE id=?").run(entry.id);
  return entry;
}
async function pair(scope = 'failure') { return Promise.all([add('First orbit policy', scope), add('Second orbit policy', scope)]); }
function entries() { return connection.sqlite.prepare('SELECT * FROM knowledge_entries ORDER BY id').all(); }
function actions() { return connection.sqlite.prepare('SELECT * FROM curation_actions ORDER BY id').all() as any[]; }
async function start(runId?: string) {
  const result = await api('POST', '/run', runId ? { runId } : {});
  expect(result.status, JSON.stringify(result.body)).toBe(202);
  return result.body.runId as string;
}
async function finished(runId: string, status = 'completed') {
  await expect.poll(async () => (await api('GET', `/runs/${runId}`)).body.run.status, { timeout: 60_000 }).toBe(status);
}
async function run() { const id = await start(); await finished(id); return id; }
async function queue(scope?: string) {
  const result = await api('GET', `/queue${scope ? `?scope=workspace:judge-${scope}` : ''}`);
  expect(result.status).toBe(200); return result.body.actions as any[];
}

test('manual run classifies all cluster and aging verdicts using bounded JSON schema requests', async () => {
  for (const verdict of ['duplicate', 'supersedes', 'complementary', 'distinct']) await pair(verdict);
  for (const verdict of ['still_valid', 'outdated', 'unsure']) await add(`Aged ${verdict}`, verdict, true);
  await add('Note', 'title');
  answer = r => {
    if (r.taskKind === 'title') return { ...valid(r, 'proposal'), payload: { title: 'Synthetic evidence' } };
    const verdict = r.entries[0].scope.replace('workspace:judge-', '');
    return { ...valid(r, verdict), ...(verdict === 'supersedes'
      ? { payload: { sourceId: r.candidateIds[0], targetId: r.candidateIds[1] } } : {}) };
  };
  const before = entries();
  await run();
  expect(entries()).toEqual(before);
  expect(actions().map(a => a.kind).sort(), JSON.stringify(requests.map(r => r.records))).toEqual(['aging', 'complementary', 'merge', 'supersedes', 'title']);
  expect(actions().every(a => a.status === 'proposed')).toBe(true);
  expect(connection.sqlite.prepare('SELECT verdict FROM curation_verdicts').all()).toEqual([{ verdict: 'distinct' }]);
  expect(requests.filter(r => r.records.taskKind === 'cluster')).toHaveLength(4);
  expect(requests.filter(r => r.records.taskKind === 'aging')).toHaveLength(3);
  for (const request of requests) {
    expect(request).toMatchObject({ stream: false, keep_alive: '2m', options: { temperature: 0 },
      format: { type: 'object', additionalProperties: false, required: ['verdict', 'confidence', 'reason', 'candidateIds'] } });
    expect(request.format.properties.verdict.enum).toContain((answer(request.records) as { verdict: string }).verdict);
    expect(request.records.candidateIds).toEqual(request.records.entries.map((e: any) => e.id));
  }
  // A cached distinct pair is not resubmitted; the other scopes still run.
  requests = [];
  await run();
  expect(requests.some(r => r.records.entries[0].scope === 'workspace:judge-distinct')).toBe(false);
  expect(entries()).toEqual(before);
});

const invalid: [string, Answer][] = [
  ['invalid JSON', () => '{broken'],
  ['JSON null', () => 'null'],
  ['JSON array', () => '[]'],
  ['empty content', () => ' '],
  ['schema-invalid verdict', r => ({ ...valid(r), verdict: 'invented' })],
  ['extra property', r => ({ ...valid(r), instruction: 'mutate' })],
  ['confidence above range', r => ({ ...valid(r), confidence: 1.01 })],
  ['confidence below range', r => ({ ...valid(r), confidence: -0.01 })],
  ['confidence wrong type', r => ({ ...valid(r), confidence: '0.99' })],
  ['missing reason', r => ({ ...valid(r), reason: undefined })],
  ['blank reason', r => ({ ...valid(r), reason: '  ' })],
  ['candidate outside submitted set', r => ({ ...valid(r), candidateIds: [randomUUID()] })],
  ['empty candidates', r => ({ ...valid(r), candidateIds: [] })],
  ['duplicate candidates', r => ({ ...valid(r), candidateIds: [r.candidateIds[0], r.candidateIds[0]] })],
  ['non-array candidates', r => ({ ...valid(r), candidateIds: 'all' })],
  ['null payload', r => ({ ...valid(r), payload: null })],
  ['array payload', r => ({ ...valid(r), payload: [] })],
  ['unknown payload property', r => ({ ...valid(r), payload: { mutate: true } })],
  ['supersedes same participant', r => ({ ...valid(r, 'supersedes'), payload: { sourceId: r.candidateIds[0], targetId: r.candidateIds[0] } })],
  ['supersedes foreign participant', r => ({ ...valid(r, 'supersedes'), payload: { sourceId: randomUUID(), targetId: r.candidateIds[0] } })],
];
for (const [name, result] of invalid) test(`judge fails closed: ${name}`, async () => {
  await pair(); answer = result;
  const before = entries();
  await run();
  expect(requests).toHaveLength(1);
  expect(entries()).toEqual(before);
  expect(actions()).toEqual([]);
  expect(await queue()).toEqual([]);
});

for (const payload of [undefined, { title: '' }, { title: 'x'.repeat(501) }]) {
  test(`title judge fails closed for ${payload === undefined ? 'missing payload' : payload.title.length + ' character title'}`, async () => {
    await add('Note', 'invalid-title');
    answer = r => ({ ...valid(r, 'proposal'), ...(payload === undefined ? {} : { payload }) });
    const before = entries();
    await run();
    expect(requests.map(r => r.records.taskKind)).toEqual(['title']);
    expect(entries()).toEqual(before); expect(actions()).toEqual([]);
  });
}

test('HTTP 500 leaves candidates untouched and authorizes no mutation', async () => {
  await pair(); transport = '500'; const before = entries();
  await run();
  expect(requests).toHaveLength(1); expect(entries()).toEqual(before); expect(actions()).toEqual([]);
});

test('missing configured model uses installed llama fallback without pulling a model', async () => {
  await pair(); answer = r => valid(r, 'distinct');
  await settings({ curationModel: 'missing-synthetic:latest' });
  const before = entries(); await run();
  expect(requests.map(r => r.model)).toEqual(['llama3.2:3b']);
  expect(pulls).toBe(0);
  expect(actions()).toEqual([]);
  expect(connection.sqlite.prepare('SELECT verdict,model FROM curation_verdicts').all())
    .toEqual([{ verdict: 'distinct', model: 'llama3.2:3b' }]);
  expect(entries()).toEqual(before);
});

test('Ollama down completes deterministic-only curation without authorizing a judge mutation', async () => {
  await pair(); const expired = await add('Expired orbit rule', 'expiry');
  connection.sqlite.prepare("UPDATE knowledge_entries SET expires_at='2000-01-01' WHERE id=?").run(expired.id);
  const before = entries();
  mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve()));
  await run();
  expect(requests).toEqual([]); expect(entries()).toEqual(before);
  expect(actions().map(a => [a.kind, a.status, JSON.parse(a.entry_ids)])).toEqual([['expire', 'proposed', [expired.id]]]);
});

test('graceful shutdown aborts a hung judge and another sidecar resumes the same run', async () => {
  await pair();
  const owner = { child, base };
  // Initialize the recovery process before the snapshot: both SDKs refresh the
  // built-in workflow seed at startup. All entries must then remain unchanged.
  await boot();
  const recovery = { child, base };
  child = owner.child; base = owner.base;
  transport = 'hang'; const before = entries();
  const runId = await start();
  await expect.poll(() => requests.length).toBe(1);
  const stopped = child;
  await stopSidecar(child); child = undefined;
  await expect.poll(() => stopped?.exitCode).toBe(0);
  expect(stopped?.signalCode).toBeNull();
  expect(connection.sqlite.prepare('SELECT status FROM curation_runs WHERE id=?').get(runId)).toEqual({ status: 'paused' });
  expect(entries()).toEqual(before); expect(actions()).toEqual([]);
  transport = 'ok'; answer = r => valid(r, 'distinct');
  child = recovery.child; base = recovery.base;
  expect(await start(runId)).toBe(runId); await finished(runId);
  expect(entries()).toEqual(before); expect(actions()).toEqual([]);
  expect(connection.sqlite.prepare('SELECT verdict FROM curation_verdicts').all()).toEqual([{ verdict: 'distinct' }]);
});

test('HTTP queue, apply, reject and undo enforce validation, missing actions and conflicts', async () => {
  await pair('merge'); await pair('reject');
  const before = entries(); await run();
  const pending = await queue(); expect(pending).toHaveLength(2);
  expect(await queue('merge')).toHaveLength(1);
  expect(await queue('absent')).toEqual([]);
  for (const path of ['/runs/bad', '/actions/bad']) expect((await api('GET', path)).status).toBe(400);
  for (const path of [`/runs/${randomUUID()}`, `/actions/${randomUUID()}`]) expect((await api('GET', path)).status).toBe(404);
  for (const operation of ['apply', 'reject', 'undo']) {
    expect((await api('POST', `/actions/bad/${operation}`, {})).status).toBe(400);
    expect((await api('POST', `/actions/${pending[0].id}/${operation}`, { unexpected: true })).status).toBe(400);
    expect((await api('POST', `/actions/${randomUUID()}/${operation}`, {})).status).toBe(404);
  }
  expect(entries()).toEqual(before); expect(await queue()).toEqual(pending);
  const applied = (await queue('merge'))[0], rejected = (await queue('reject'))[0];
  expect((await api('POST', `/actions/${applied.id}/undo`, {})).status).toBe(409);
  const apply = await api('POST', `/actions/${applied.id}/apply`, {});
  expect(apply.status).toBe(200); expect(apply.body.action.status).toBe('applied');
  expect(entries().filter((e: any) => e.status === 'superseded')).toHaveLength(1);
  expect((await api('POST', `/actions/${applied.id}/apply`, {})).status).toBe(409);
  expect((await api('POST', `/actions/${applied.id}/reject`, {})).status).toBe(409);
  const undo = await api('POST', `/actions/${applied.id}/undo`, {});
  expect(undo.status).toBe(200); expect(undo.body.action.status).toBe('undone'); expect(entries()).toEqual(before);
  const reject = await api('POST', `/actions/${rejected.id}/reject`, {});
  expect(reject.status).toBe(200); expect(reject.body.action.status).toBe('rejected');
  for (const operation of ['apply', 'reject', 'undo']) expect((await api('POST', `/actions/${rejected.id}/${operation}`, {})).status).toBe(409);
  expect(await queue()).toEqual([]); expect(entries()).toEqual(before);
});

test('MCP calls persist shared activity through the worker and leave automatic scheduling idle', async () => {
  await add('MCP activity policy', 'activity');
  const client = await connectMcp(bundleLaunch(), { HOME: home, COGNISTORE_HOME: join(home, '.cognistore'),
    SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'), OLLAMA_HOST: host, OLLAMA_MODEL: 'nomic-embed-text' });
  const before = new Date().toISOString();
  try {
    const results = await Promise.all(Array.from({ length: 4 }, () => callJson(client, 'getKnowledge', { query: 'MCP activity policy' })));
    expect(results.every(r => !r.isError)).toBe(true);
    await expect.poll(() => {
      const row = connection.sqlite.prepare('SELECT last_seen_at FROM curation_activity WHERE singleton=1').get() as any;
      return row?.last_seen_at >= before;
    }).toBe(true);
  } finally { await client.close(); }
  const activity = connection.sqlite.prepare('SELECT last_seen_at FROM curation_activity WHERE singleton=1').get() as any;
  expect(Number.isFinite(Date.parse(activity.last_seen_at))).toBe(true);
  expect(connection.sqlite.prepare("SELECT id FROM curation_runs WHERE trigger='automatic'").all()).toEqual([]);
  // Read the public scheduler-facing run status after activity, without waiting for a timer tick.
  const runId = await run();
  expect((await api('GET', `/runs/${runId}`)).body.run).toMatchObject({ status: 'completed', trigger: 'manual' });
  expect(actions()).toEqual([]);
});
