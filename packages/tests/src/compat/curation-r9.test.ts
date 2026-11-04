import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import BetterSqlite3 from 'better-sqlite3';
import { createDbClient, KnowledgeRepository, CurationRepository, JobRunner } from '@cognistore/core';
import { runMigrations } from '../../../core/src/db/migrate.js';
import { MCP_ENTRY, bundleLaunch, callJson, connectMcp, npxLaunch, npxInstalledVersions, warmNpx, type McpLaunch } from '../mcp-helpers.js';
import { SERVER_ENTRY, TEST_TOKEN, authFetch, getFreePort, spawnSidecar, stopSidecar, waitForSidecar } from '../sidecar-helpers.js';

const sqliteVec = createRequire(import.meta.url)('sqlite-vec');
const NPM_VERSIONS = ['2.5.3', '2.5.4']; // Same published launch matrix as mcp-matrix.test.ts.
const vector = [1, ...Array(255).fill(0)];
let home: string, host: string, mock: Server;
let chatCalls = 0;
const worker = resolve(import.meta.dirname, '../../../../apps/mcp-server/dist/jobs/worker.js');
const migrationDir = resolve(import.meta.dirname, '../../../core/src/db/migrations');

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.beforeEach(async () => {
  test.skip(!existsSync(MCP_ENTRY), 'Built MCP required; no source substitute');
  home = mkdtempSync(join(tmpdir(), 'curation-r9-compat-')); chatCalls = 0;
  mock = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}'); res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return void res.end(JSON.stringify({ models: [{ name: 'nomic-embed-text' }, { name: 'llama3.2:3b' }] }));
    if (req.url === '/api/embeddings') return void res.end(JSON.stringify({ embedding: vector }));
    if (req.url === '/api/chat') {
      chatCalls++;
      const records = JSON.parse(body.messages[1].content.replace(/^<records>|<\/records>$/g, ''));
      return void res.end(JSON.stringify({ message: { content: JSON.stringify({ verdict: 'duplicate', confidence: 0.99, reason: 'Synthetic paraphrases', candidateIds: records.candidateIds }) } }));
    }
    res.writeHead(404).end('{}'); // No pulls, subprocesses or model removal.
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
  host = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
});
test.afterEach(async () => {
  if (mock) { mock.closeAllConnections(); await new Promise<void>(r => mock.close(() => r())); }
  if (home) rmSync(home, { recursive: true, force: true });
});
function env(db: string) {
  const sessionHome = mkdtempSync(join(home, 'session-'));
  return { HOME: sessionHome, COGNISTORE_HOME: join(sessionHome, '.cognistore'), SQLITE_PATH: db,
    OLLAMA_HOST: host, OLLAMA_MODEL: 'nomic-embed-text', COGNISTORE_PLATFORM: 'claude-code' };
}
async function session<T>(launch: McpLaunch, db: string, fn: (client: Awaited<ReturnType<typeof connectMcp>>) => Promise<T>) {
  const client = await connectMcp(launch, env(db));
  try { return await fn(client); } finally { await client.close(); }
}
async function ok(client: Awaited<ReturnType<typeof connectMcp>>, name: string, args: Record<string, unknown>) {
  const result = await callJson(client, name, args); expect(result.isError, JSON.stringify(result.body)).toBe(false); return result.body as any;
}
function entry(label: string, scope = `workspace:fictional-${label}`) {
  return { title: `Synthetic ${label}`, content: `Fictional policy ${label}`, tags: ['synthetic'], type: 'pattern', scope, source: 'r9-compat' };
}

test('old npm MCP writes active-default entries after 2.4.6', async () => {
  const sandbox = join(home, 'npm'); mkdirSync(sandbox, { mode: 0o700 });
  try { for (const version of NPM_VERSIONS) warmNpx(version, sandbox); }
  catch (error) {
    const limitation = `NPM COVERAGE UNVERIFIED: published MCP launch matrix unavailable: ${String(error)}`;
    test.info().annotations.push({ type: 'verification limitation', description: limitation });
    if (process.env.CI) throw new Error(limitation);
    test.skip(true, limitation); return;
  }
  const db = join(home, 'migrated.db');
  const connection = createDbClient(db);
  try { expect(connection.sqlite.prepare("SELECT version FROM schema_version WHERE version='2.4.6'").get()).toEqual({ version: '2.4.6' }); }
  finally { connection.sqlite.close(); }
  for (const version of NPM_VERSIONS) {
    expect(npxInstalledVersions(sandbox)).toContain(version);
    const id = await session(npxLaunch(version, sandbox), db, async client => {
      const body = await ok(client, 'addKnowledge', { entries: entry(`npm-${version}`) });
      return body.entry.id as string;
    });
    const check = createDbClient(db);
    try { expect(new CurationRepository(check.sqlite).getEntry(id)).toMatchObject({ id, status: 'active', superseded_by: null }); }
    finally { check.sqlite.close(); }
    await session(bundleLaunch(), db, async client => {
      const body = await ok(client, 'getKnowledge', { query: `Fictional policy npm-${version}`, scope: `workspace:fictional-npm-${version}` });
      expect(JSON.stringify(body)).toContain(id);
    });
  }
});

test('bundled worker runs curation against disk and embedded migration databases', async () => {
  test.skip(!existsSync(worker), 'Built MCP worker required');
  for (const mode of ['disk', 'embedded']) {
    const path = join(home, `${mode}.db`);
    const raw = new BetterSqlite3(path); sqliteVec.load(raw);
    try {
      runMigrations(raw, mode === 'disk' ? migrationDir : join(home, 'absent-migrations'));
      expect(raw.prepare("SELECT version FROM schema_version WHERE version='2.4.6'").get()).toBeTruthy();
    } finally { raw.close(); }
    const connection = createDbClient(path);
    const repository = new KnowledgeRepository(connection.db, connection.sqlite);
    const a = await repository.create({ ...entry(`${mode}-a`, 'workspace:fictional-worker'), embedding: vector } as any);
    const b = await repository.create({ ...entry(`${mode}-b`, 'workspace:fictional-worker'), embedding: vector } as any);
    const runner = new JobRunner({ workerUrl: pathToFileURL(worker), databasePath: path, embeddingConfig: { host, model: 'nomic-embed-text', dimensions: 256 } });
    try {
      const health = await runner.run('health', {}); expect(health.threadId).toBeGreaterThan(0);
      const result = await runner.run('curation.run', { autonomy: 'suggest', budgetMs: 60_000, maxClusters: 10, maxItems: 100,
        trashRetentionDays: 30, clusterThreshold: 0.85, deprecatedUnreadDays: 90, model: 'llama3.2:3b', trigger: 'manual' });
      expect(result).toMatchObject({ status: 'completed', failures: [], applied: 0 }); expect(result.proposed).toBeGreaterThan(0);
      expect(chatCalls).toBeGreaterThan(mode === 'disk' ? 0 : 1);
      const repo = new CurationRepository(connection.sqlite);
      const action = (repo.listActions(null, 100, result.runId) as any[]).find(a => a.kind === 'merge');
      expect(action).toBeTruthy(); expect(JSON.parse(action.entry_ids).sort()).toEqual([a.id, b.id].sort());
      expect(await runner.run('curation.apply', { actionId: action.id })).toEqual({ applied: true });
      expect([repo.getEntry(a.id).status, repo.getEntry(b.id).status].sort()).toEqual(['active', 'superseded']);
      expect(connection.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally { await runner.close(); connection.sqlite.close(); }
  }
});

test('curation additions preserve historical HTTP routes and response fields', async () => {
  test.skip(!existsSync(SERVER_ENTRY), 'Built sidecar required');
  const path = join(home, 'http.db'); const port = await getFreePort(); const base = `http://127.0.0.1:${port}`;
  const started = spawnSidecar({ ...env(path), SIDECAR_TOKEN: TEST_TOKEN, DASHBOARD_PORT: String(port) });
  const api = async (method: string, route: string, body?: unknown) => {
    const response = await authFetch(`${base}${route}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    expect(response.status, await response.clone().text()).toBe(200); return await response.json() as any;
  };
  try {
    expect(await waitForSidecar(base), started.readLog()).toBe(true);
    expect(await api('GET', '/api/health')).toMatchObject({ database: { connected: true } });
    const wrote = await api('POST', '/api/knowledge', entry('http'));
    expect(wrote).toMatchObject({ id: expect.any(String), title: 'Synthetic http', content: 'Fictional policy http', tags: ['synthetic'], version: 1 });
    expect(await api('GET', `/api/knowledge/${wrote.id}`)).toMatchObject({ id: wrote.id, scope: 'workspace:fictional-http', source: 'r9-compat' });
    const search = await api('POST', '/api/knowledge/search', { query: 'Fictional policy http', threshold: 0 });
    expect(Array.isArray(search)).toBe(true); expect(search).toEqual(expect.arrayContaining([expect.objectContaining({ entry: expect.objectContaining({ id: wrote.id }), similarity: expect.any(Number) })]));
    expect(await api('PUT', `/api/knowledge/${wrote.id}`, { content: 'Fictional amended policy' })).toMatchObject({ id: wrote.id, version: 2 });
    expect(Array.isArray(await api('GET', '/api/knowledge/recent'))).toBe(true);
    expect(await api('GET', '/api/curation/queue')).toMatchObject({ actions: [], nextCursor: null });
    const settings = await api('GET', '/api/settings'); expect(settings.curationAutonomy).toBe('suggest');
    expect(await api('DELETE', `/api/knowledge/${wrote.id}`)).toEqual({ deleted: true });
  } finally { await stopSidecar(started.child); }
});

test('new optional supersedes survives single batch and update MCP boundaries', async () => {
  const path = join(home, 'mcp.db');
  await session(bundleLaunch(), path, async client => {
    const a = (await ok(client, 'addKnowledge', { entries: entry('single-a') })).entry;
    const single = (await ok(client, 'addKnowledge', { entries: { ...entry('single-b', a.scope), supersedes: [a.id] } })).entry;
    const old1 = (await ok(client, 'addKnowledge', { entries: entry('batch-a') })).entry;
    const old2 = (await ok(client, 'addKnowledge', { entries: entry('batch-b') })).entry;
    const batch = await ok(client, 'addKnowledge', { entries: [
      { ...entry('batch-new-a', old1.scope), supersedes: [old1.id] },
      { ...entry('batch-new-b', old2.scope), supersedes: [old2.id] },
    ] });
    expect(batch.created).toBe(2);
    const target = (await ok(client, 'addKnowledge', { entries: entry('update-old') })).entry;
    const source = (await ok(client, 'addKnowledge', { entries: entry('update-new', target.scope) })).entry;
    const update = await ok(client, 'updateKnowledge', { id: source.id, content: 'Fictional revised policy', supersedes: [target.id] });
    expect(update).toMatchObject({ id: source.id, version: 2 });
    const check = createDbClient(path);
    try {
      const repo = new CurationRepository(check.sqlite);
      for (const [oldId, newId] of [[a.id, single.id], [old1.id, batch.entries[0].entry.id], [old2.id, batch.entries[1].entry.id], [target.id, source.id]]) {
        expect(repo.getEntry(oldId)).toMatchObject({ status: 'superseded', superseded_by: newId });
        expect(repo.getEntry(newId).status).toBe('active');
      }
      expect(check.sqlite.prepare("SELECT count(*) AS n FROM curation_actions WHERE kind='supersedes' AND status='applied'").get()).toEqual({ n: 4 });
      expect(check.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally { check.sqlite.close(); }
  });
});
