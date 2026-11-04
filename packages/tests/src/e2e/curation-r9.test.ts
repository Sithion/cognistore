import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createDbClient, KnowledgeRepository, CurationRepository, type CurationJobOptions } from '@cognistore/core';
import { KnowledgeSDK } from '@cognistore/sdk';
import { SERVER_ENTRY, TEST_TOKEN, authFetch, getFreePort, spawnSidecar, stopSidecar, waitForSidecar } from '../sidecar-helpers.js';
import { MCP_ENTRY, bundleLaunch, callJson, connectMcp } from '../mcp-helpers.js';
import { ollamaModels, removeOwnedModels } from '../../../../apps/dashboard/server/curation-models.js';

// Every process receives an isolated HOME and explicit database/model endpoints.
// The only HTTP model server in this suite is this deterministic loopback mock.
let home: string, base: string, host: string, child: ChildProcess | undefined, mock: Server;
let connection: ReturnType<typeof createDbClient>, sdk: KnowledgeSDK;
let verdict: 'duplicate' | 'supersedes' | 'complementary' | 'distinct';
let chatCalls: number, pulls: string[], removals: string[], installed: Set<string>;
const vector = [1, ...Array(255).fill(0)];
const options = (autonomy: CurationJobOptions['autonomy'] = 'suggest'): CurationJobOptions => ({
  autonomy, budgetMs: 60_000, maxClusters: 50, maxItems: 100, trashRetentionDays: 30,
  clusterThreshold: 0.85, deprecatedUnreadDays: 90, model: 'llama3.2:3b', trigger: 'manual',
});

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.beforeEach(async () => {
  test.skip(!existsSync(SERVER_ENTRY) || !existsSync(MCP_ENTRY), 'Built sidecar/MCP required; no source substitute');
  home = mkdtempSync(join(tmpdir(), 'curation-r9-'));
  mkdirSync(join(home, '.cognistore'));
  verdict = 'duplicate'; chatCalls = 0; pulls = []; removals = [];
  installed = new Set(['nomic-embed-text', 'llama3.2:3b', 'preexisting:latest']);
  mock = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return void res.end(JSON.stringify({ models: [...installed].map(name => ({ name })) }));
    if (req.url === '/api/embeddings') return void res.end(JSON.stringify({ embedding: vector }));
    if (req.url === '/api/pull') { pulls.push(body.name ?? body.model); installed.add(body.name ?? body.model); return void res.end(JSON.stringify({ status: 'success' })); }
    if (req.url === '/api/delete' && req.method === 'DELETE') { removals.push(body.name); installed.delete(body.name); return void res.end('{}'); }
    if (req.url === '/api/chat') {
      chatCalls++;
      const records = JSON.parse(body.messages[1].content.replace(/^<records>|<\/records>$/g, ''));
      const ids: string[] = records.candidateIds;
      const newer = records.entries.find((e: any) => e.title.includes('Newer'))?.id ?? ids[0];
      const result = records.taskKind === 'cluster'
        ? { verdict, confidence: 0.99, reason: 'Deterministic synthetic cluster', candidateIds: ids,
          ...(verdict === 'supersedes' ? { payload: { sourceId: newer, targetId: ids.find(id => id !== newer) } } : {}) }
        : { verdict: 'still_valid', confidence: 0.99, reason: 'Synthetic record remains valid', candidateIds: ids };
      return void res.end(JSON.stringify({ message: { content: JSON.stringify(result) } }));
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
  host = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  const path = join(home, '.cognistore', 'knowledge.db');
  connection = createDbClient(path);
  sdk = new KnowledgeSDK({ database: { path }, ollama: { host, model: 'nomic-embed-text', dimensions: 256 } });
  await sdk.initialize();
  const port = await getFreePort(); base = `http://127.0.0.1:${port}`;
  const started = spawnSidecar({ HOME: home, COGNISTORE_HOME: join(home, '.cognistore'), SQLITE_PATH: path,
    OLLAMA_HOST: host, OLLAMA_MODEL: 'nomic-embed-text', DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN });
  child = started.child;
  expect(await waitForSidecar(base), started.readLog()).toBe(true);
});
test.afterEach(async () => {
  await stopSidecar(child); child = undefined;
  await sdk?.close(); connection?.sqlite.close();
  if (mock) { mock.closeAllConnections(); await new Promise<void>(r => mock.close(() => r())); }
  // Only the freshly created fixture directory is removed.
  if (home) rmSync(home, { recursive: true, force: true });
});
async function api(method: string, path: string, body?: unknown) {
  const response = await authFetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
async function add(title: string, content: string, scope = 'workspace:fictional-orbit', tags: string[] = [], type = 'pattern') {
  return new KnowledgeRepository(connection.db, connection.sqlite).create({ title, content, scope, tags, type, source: 'synthetic-r9', embedding: vector } as any);
}
function entries() { return connection.sqlite.prepare('SELECT id,title,content,tags,type,scope,status,superseded_by,version FROM knowledge_entries ORDER BY id').all(); }
function actions() { return connection.sqlite.prepare('SELECT * FROM curation_actions ORDER BY id').all() as any[]; }
async function queue() { const r = await api('GET', '/api/curation/queue'); expect(r.status).toBe(200); return r.body.actions as any[]; }
async function runHttp() {
  const started = await api('POST', '/api/curation/run', {}); expect(started.status).toBe(202);
  await expect.poll(async () => (await api('GET', `/api/curation/runs/${started.body.runId}`)).body.run.status, { timeout: 60_000 }).toBe('completed');
  return started.body.runId as string;
}

test('suggest run queues rule and LLM proposals without changing knowledge', async () => {
  await add('Expired synthetic rule', 'Expired synthetic content', 'workspace:fictional-rule');
  connection.sqlite.prepare("UPDATE knowledge_entries SET expires_at='2000-01-01' WHERE scope='workspace:fictional-rule'").run();
  await add('Orbit original', 'Orbit retry policy is three');
  await add('Orbit paraphrase', 'Orbit permits three retries');
  const before = entries();
  await runHttp();
  expect(chatCalls).toBeGreaterThan(0);
  const pending = await queue();
  expect(pending.map(a => a.kind)).toEqual(expect.arrayContaining(['expire', 'merge']));
  expect(pending.every(a => a.status === 'proposed')).toBe(true);
  expect(entries()).toEqual(before);
  for (const action of pending) {
    const detail = await api('GET', `/api/curation/actions/${action.id}`);
    expect(detail.body.action.entries.length).toBeGreaterThan(0);
  }
});

test('approved merge and undo restore searchable content vectors and relations', async () => {
  const a = await add('Orbit original', 'Orbit retry policy is three', undefined, ['orbit']);
  const b = await add('Orbit paraphrase', 'Orbit permits three retries', undefined, ['retry']);
  const repository = new KnowledgeRepository(connection.db, connection.sqlite);
  const plan = repository.createPlan({ title: 'Synthetic reference', content: 'Synthetic plan', tags: [], scope: 'workspace:fictional-orbit', source: 'r9', embedding: vector });
  repository.addPlanRelation(plan.id, b.id, 'input');
  connection.sqlite.prepare('UPDATE knowledge_entries SET related_ids=? WHERE id=?').run(JSON.stringify([a.id]), b.id);
  const repo = new CurationRepository(connection.sqlite), before = entries();
  const vectors = [repo.readVector(a.id), repo.readVector(b.id)];
  const relations = connection.sqlite.prepare('SELECT * FROM plan_relations ORDER BY id').all();
  await runHttp();
  const action = (await queue()).find(a => a.kind === 'merge'); expect(action).toBeTruthy();
  expect((await api('POST', `/api/curation/actions/${action.id}/apply`, {})).body.action.status).toBe('applied');
  expect(entries().filter((e: any) => e.status === 'superseded')).toHaveLength(1);
  expect((await api('POST', `/api/curation/actions/${action.id}/undo`, {})).body.action.status).toBe('undone');
  expect(entries()).toEqual(before);
  expect([repo.readVector(a.id), repo.readVector(b.id)]).toEqual(vectors);
  expect(connection.sqlite.prepare('SELECT * FROM plan_relations ORDER BY id').all()).toEqual(relations);
  expect(JSON.parse(repo.getEntry(b.id).related_ids)).toEqual([a.id]);
  const search = await api('POST', '/api/knowledge/search', { query: 'Orbit retry', threshold: 0, limit: 100 });
  expect(search.status).toBe(200); expect(JSON.stringify(search.body)).toContain(a.id); expect(JSON.stringify(search.body)).toContain(b.id);
});

for (const collision of [false, true]) test(`undo preserves relation identity and sequence with unrelated rows (collision=${collision})`, async () => {
  const target = await add('Target rule', 'Synthetic target policy');
  const unrelated = await add('Unrelated rule', 'Synthetic unrelated policy', 'workspace:fictional-unrelated');
  const repository = new KnowledgeRepository(connection.db, connection.sqlite);
  const plan = repository.createPlan({ title: 'Synthetic undo reference', content: 'Synthetic plan', tags: [], scope: target.scope, source: 'r9', embedding: vector });
  repository.addPlanRelation(plan.id, target.id, 'input');
  const db = connection.sqlite, repo = new CurationRepository(db);
  const original = db.prepare('SELECT * FROM plan_relations WHERE knowledge_id=?').get(target.id) as any;
  const now = new Date().toISOString(), row = repo.getEntry(target.id);
  const before = repo.captureSnapshot([target.id]);
  const action = repo.createAction({ id: crypto.randomUUID(), kind: 'title', actor: 'test', entryIds: [target.id], snapshot: before,
    payload: { title: 'Changed target rule' }, versions: { [target.id]: row.version }, key: `relation-undo:${target.id}`, now });
  expect(repo.applyAction(action.id, now, () => {
    repo.mutateEntry(target.id, { title: 'Changed target rule' }, now);
    db.prepare('DELETE FROM plan_relations WHERE id=?').run(original.id);
  })).toBe(true);
  const inserted = db.prepare('INSERT INTO plan_relations(id,plan_id,knowledge_id,relation_type,created_at) VALUES(?,?,?,?,?)')
    .run(collision ? original.id : null, plan.id, unrelated.id, 'output', now);
  const snapshot = repo.captureSnapshot([target.id, unrelated.id]);
  const relations = db.prepare('SELECT * FROM plan_relations ORDER BY id').all();
  const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='plan_relations'").get();
  const applied = repo.getAction(action.id);
  const undone = await api('POST', `/api/curation/actions/${action.id}/undo`, {});
  expect(undone.status).toBe(collision ? 409 : 200);
  if (collision) {
    expect(repo.captureSnapshot([target.id, unrelated.id])).toEqual(snapshot);
    expect(repo.getAction(action.id)).toEqual(applied);
    expect(db.prepare('SELECT * FROM plan_relations ORDER BY id').all()).toEqual(relations);
    expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='plan_relations'").get()).toEqual(sequence);
  } else {
    expect(repo.captureSnapshot([target.id])).toEqual(before);
    expect(db.prepare('SELECT * FROM plan_relations WHERE knowledge_id=?').get(target.id)).toEqual(original);
    expect(db.prepare('SELECT * FROM plan_relations WHERE knowledge_id=?').all(unrelated.id)).toEqual(relations);
    repository.addPlanRelation(plan.id, target.id, 'output');
    const next = db.prepare("SELECT id FROM plan_relations WHERE knowledge_id=? AND relation_type='output'").get(target.id) as any;
    expect(next.id).toBeGreaterThan(Number(inserted.lastInsertRowid));
  }
});

test('supersedes is atomic through HTTP and existing MCP tools', async () => {
  const old = await add('Old orbit rule', 'Orbit retry count was two');
  const kept = await add('Protected orbit rule', 'Keep this synthetic rule', undefined, ['keep']);
  const before = entries();
  const failed = await api('POST', '/api/knowledge', { title: 'Rejected replacement', content: 'Orbit retries four times', tags: ['synthetic'], type: 'pattern', scope: old.scope, source: 'r9', supersedes: [old.id, kept.id] });
  expect(failed.status).toBeGreaterThanOrEqual(400); expect(entries()).toEqual(before);
  expect(failed.body.error).toContain('supersession target');
  const newer = await api('POST', '/api/knowledge', { title: 'Newer orbit rule', content: 'Orbit retries four times', tags: ['synthetic'], type: 'pattern', scope: old.scope, source: 'r9', supersedes: [old.id] });
  expect(newer.status, JSON.stringify(newer.body)).toBe(200);
  expect(new CurationRepository(connection.sqlite).getEntry(old.id)).toMatchObject({ status: 'superseded', superseded_by: newer.body.id });
  const client = await connectMcp(bundleLaunch(), { HOME: home, COGNISTORE_HOME: join(home, '.cognistore'), SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'), OLLAMA_HOST: host, OLLAMA_MODEL: 'nomic-embed-text' });
  try {
    const original = await add('MCP old', 'MCP prior decision', 'workspace:fictional-mcp');
    const result = await callJson(client, 'addKnowledge', { entries: { title: 'MCP newer', content: 'MCP replaces prior decision', tags: ['synthetic'], type: 'pattern', scope: original.scope, source: 'r9', supersedes: [original.id] } });
    expect(result.isError).toBe(false);
    const source = (result.body as any).entry.id;
    expect(new CurationRepository(connection.sqlite).getEntry(original.id)).toMatchObject({ status: 'superseded', superseded_by: source });
    const snapshot = entries();
    const cycle = await callJson(client, 'updateKnowledge', { id: original.id, supersedes: [source] });
    expect(cycle.isError).toBe(true); expect(entries()).toEqual(snapshot);
  } finally { await client.close(); }
});

test('retention purges expired trash and preserves recoverable recent trash', async () => {
  const expired = await add('Expired trash', 'Synthetic expired trash', 'workspace:fictional-expired');
  const recent = await add('Recent trash', 'Synthetic recoverable trash', 'workspace:fictional-recent');
  connection.sqlite.prepare("UPDATE knowledge_entries SET expires_at='2000-01-01' WHERE id IN (?,?)").run(expired.id, recent.id);
  await sdk.runCuration(options('auto-safe'));
  const recentAction = actions().find(a => JSON.parse(a.entry_ids).includes(recent.id));
  expect(recentAction.status).toBe('applied');
  // Explicit dates straddle the retention boundary; there are no sleep races.
  const now = new Date().toISOString();
  connection.sqlite.prepare("UPDATE knowledge_entries SET trashed_at='2000-01-01' WHERE id=?").run(expired.id);
  expect(Date.parse(new CurationRepository(connection.sqlite).getEntry(recent.id).trashed_at)).toBeLessThanOrEqual(Date.parse(now));
  expect(await sdk.purgeCurationTrash({ autonomy: 'auto-safe', retentionDays: 30 })).toEqual({ purged: 1 });
  const repo = new CurationRepository(connection.sqlite);
  expect(repo.getEntry(expired.id)).toBeUndefined(); expect(repo.readVector(expired.id)).toBeNull();
  expect(repo.getEntry(recent.id).status).toBe('trashed');
  await sdk.undoCurationAction(recentAction.id);
  expect(repo.getEntry(recent.id)).toMatchObject({ status: 'active', content: 'Synthetic recoverable trash' });
  expect(repo.readVector(recent.id)).toEqual(vector);
});

test('autonomy levels preserve keep and system entries', async () => {
  const kept = await add('Kept synthetic rule', 'Kept policy', undefined, ['keep', 'typescript']);
  const system = await add('System synthetic rule', 'System policy', undefined, ['typescript'], 'system');
  connection.sqlite.prepare("UPDATE knowledge_entries SET expires_at='2000-01-01' WHERE id IN (?,?)").run(kept.id, system.id);
  const protectedBefore = entries().filter((e: any) => [kept.id, system.id].includes(e.id));
  for (const level of ['off', 'suggest', 'auto-safe', 'auto'] as const) {
    const control = await add(`Ordinary ${level}`, `Ordinary synthetic ${level}`, `workspace:fictional-${level}`, ['typescript']);
    const result = await sdk.runCuration(options(level));
    expect(result.status).toBe('completed');
    expect(entries().filter((e: any) => [kept.id, system.id].includes(e.id))).toEqual(protectedBefore);
    expect(actions().some(a => JSON.parse(a.entry_ids).some((id: string) => id === kept.id || id === system.id))).toBe(false);
    const tags = JSON.parse(new CurationRepository(connection.sqlite).getEntry(control.id).tags);
    // The autonomy contract keeps tag normalization proposed in auto-safe.
    expect(tags).toEqual(level === 'auto' ? ['ts'] : ['typescript']);
    const tagActions = actions().filter(a => a.kind === 'tags' && JSON.parse(a.entry_ids).includes(control.id));
    expect(tagActions).toHaveLength(level === 'off' ? 0 : 1);
    if (level !== 'off') expect(tagActions[0]).toMatchObject({ status: level === 'auto' ? 'applied' : 'proposed', payload: JSON.stringify({ tags: ['ts'] }) });
  }
});

test('interrupted budgeted worker resumes without duplicated actions', async () => {
  await add('Identical synthetic rule', 'Same synthetic body');
  await add('Identical synthetic rule', 'Same synthetic body');
  const before = entries();
  // A zero budget deterministically interrupts at the first durable checkpoint.
  const interrupted = await sdk.runCuration({ ...options(), budgetMs: 0 });
  expect(interrupted.status).toBe('paused');
  expect(actions().length).toBeGreaterThan(0);
  const initialIds = actions().map(a => a.id);
  await sdk.close();
  const restarted = new KnowledgeSDK({ database: { path: join(home, '.cognistore', 'knowledge.db') }, ollama: { host, model: 'nomic-embed-text', dimensions: 256 } });
  sdk = restarted; await sdk.initialize();
  const resumed = await sdk.resumeCuration(interrupted.runId, options());
  expect(resumed).toMatchObject({ runId: interrupted.runId, status: 'completed', failures: [] });
  const completedActions = actions();
  expect(completedActions.map(a => a.id)).toEqual(expect.arrayContaining(initialIds));
  expect(completedActions.filter(a => a.kind === 'duplicate')).toHaveLength(1);
  expect(new Set(completedActions.map(a => a.idempotency_key)).size).toBe(completedActions.length);
  expect(entries()).toEqual(before);
  await sdk.resumeCuration(interrupted.runId, options());
  expect(actions()).toEqual(completedActions);
});

test('manual scheduling and queue routes enforce authentication and conflicts', async () => {
  expect((await fetch(`${base}/api/curation/queue`)).status).toBe(403);
  expect((await fetch(`${base}/api/curation/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
  expect((await api('POST', '/api/curation/run', { unknown: true })).status).toBe(400);
  for (const query of ['limit=0', 'scope=invalid', 'cursor=broken', 'unknown=true']) expect((await api('GET', `/api/curation/queue?${query}`)).status).toBe(400);
  expect((await api('PUT', '/api/settings', { curationAutonomy: 'off' })).status).toBe(200);
  expect((await api('POST', '/api/curation/run', {})).status).toBe(409);
  expect((await api('PUT', '/api/settings', { curationAutonomy: 'suggest' })).status).toBe(200);
  await add('Orbit one', 'Orbit count three', undefined, ['typescript']); await add('Orbit two', 'Orbit retry count three');
  const runId = await runHttp();
  expect((await api('POST', '/api/curation/run', { runId })).body.runId).toBe(runId);
  const first = await api('GET', '/api/curation/queue?limit=1');
  expect(first.body.actions).toHaveLength(1); expect(first.body.nextCursor).toEqual(expect.any(String));
  expect(first.body.actions[0]).not.toHaveProperty('entries');
  const second = await api('GET', `/api/curation/queue?limit=1&cursor=${first.body.nextCursor}`);
  expect(second.body.actions[0].id).not.toBe(first.body.actions[0].id);
  const action = first.body.actions[0];
  expect((await api('POST', `/api/curation/actions/${action.id}/reject`, {})).body.action.status).toBe('rejected');
  expect((await api('POST', `/api/curation/actions/${action.id}/apply`, {})).status).toBe(409);
  expect((await api('POST', `/api/curation/actions/${action.id}/undo`, {})).status).toBe(409);
});

test('model preparation and uninstall preserve pre-existing models', async () => {
  expect((await api('PUT', '/api/settings', { curationModel: 'preexisting:latest' })).status).toBe(200);
  const existing = await api('POST', '/api/curation/model/prepare', {});
  expect(existing.body).toMatchObject({ model: 'preexisting:latest', available: true, installed: false });
  expect(pulls).toEqual([]);
  expect((await api('PUT', '/api/settings', { curationModel: 'qwen2.5:7b-instruct' })).status).toBe(200);
  expect((await api('POST', '/api/curation/model/prepare', {})).body).toMatchObject({ available: true, installed: true });
  expect((await api('POST', '/api/curation/model/prepare', {})).body.installed).toBe(false);
  expect(pulls).toEqual(['qwen2.5:7b-instruct']);
  const settings = JSON.parse(readFileSync(join(home, '.cognistore', 'settings.json'), 'utf8'));
  expect(settings.installedCurationModels).toEqual(['qwen2.5:7b-instruct']);
  // Exercise the uninstall model-ownership boundary with the mock transport;
  // never invoke the uninstall route, a system binary, or the real model store.
  expect(await removeOwnedModels(settings, ollamaModels(host))).toEqual(['qwen2.5:7b-instruct']);
  expect(removals).toEqual(['qwen2.5:7b-instruct']);
  expect(installed.has('preexisting:latest')).toBe(true); expect(installed.has('llama3.2:3b')).toBe(true);
});
