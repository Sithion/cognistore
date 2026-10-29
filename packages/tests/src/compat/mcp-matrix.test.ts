import { test, expect } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { KnowledgeSDK } from '@cognistore/sdk';
import { createDbClient } from '@cognistore/core';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';
import {
  SERVER_ENTRY, TEST_TOKEN, authFetch, getFreePort, spawnSidecar, startMockOllama, stopSidecar, waitForSidecar,
} from '../sidecar-helpers.js';
import { MCP_ENTRY, type McpLaunch, bundleLaunch, callJson, connectMcp, npxInstalledVersions, npxLaunch, warmNpx } from '../mcp-helpers.js';

/**
 * MCP × database matrix (plan v2.6, T.4). Agents run whatever MCP build npx
 * resolved for them, against the one database the app keeps upgrading, so
 * mixed versions are the normal case:
 *   - the published 2.5.3 and 2.5.4 servers (real npx, sandboxed) on a 2.6 database;
 *   - the 2.6 server on a 2.5.4 database (the T.3 fixture), and 2.5.4 again after it;
 *   - the 2.6 app (real sidecar) and both 2.5.x servers writing at the same time.
 * Smoke = addKnowledge, getKnowledge, createPlan, updatePlanTask, and every
 * write must be readable by the other version.
 *
 * Needs the network for npx (cached in the OS temp dir after the first run).
 * Offline it skips locally; in CI it fails.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_254 = resolve(__dirname, '../../fixtures/upgrade/2.5.4.db.gz');
const NPM_VERSIONS = ['2.5.3', '2.5.4'];
// Per user: a shared, predictable /tmp path could be pre-seeded by another account.
const NPX_SANDBOX = join(tmpdir(), `cognistore-mcp-matrix-npx-${process.getuid?.() ?? 'user'}-abi${process.versions.modules}`);
const MODEL = 'nomic-embed-text';

let work: string;
let mock: Awaited<ReturnType<typeof startMockOllama>>;
let npxError: string | undefined;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async () => {
  test.skip(!existsSync(MCP_ENTRY), `built MCP server missing at ${MCP_ENTRY} — run \`pnpm build\` first`);
  work = mkdtempSync(join(tmpdir(), 'cognistore-mcp-matrix-'));
  mock = await startMockOllama(MODEL);
  try {
    for (const v of NPM_VERSIONS) warmNpx(v, NPX_SANDBOX);
  } catch (e) {
    npxError = e instanceof Error ? e.message : String(e);
  }
});

test.afterAll(async () => {
  await new Promise<void>((r) => (mock ? mock.server.close(() => r()) : r()));
  if (work) rmSync(work, { recursive: true, force: true });
});

function needNpx() {
  if (npxError && process.env.CI) throw new Error(`npx could not fetch the published MCP server: ${npxError}`);
  test.skip(!!npxError, `npx unavailable (offline?): ${npxError}`);
}

/** Env of one MCP session on `db`: a sandboxed HOME, never the real one. */
function sessionEnv(db: string): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(work, 'home-'));
  return {
    HOME: home,
    SQLITE_PATH: db,
    COGNISTORE_HOME: join(home, '.cognistore'),
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
    OLLAMA_MODEL: MODEL,
    COGNISTORE_PLATFORM: 'claude-code',
  };
}

async function withMcp<T>(launch: McpLaunch, db: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await connectMcp(launch, sessionEnv(db));
  try { return await fn(client); } finally { await client.close().catch(() => {}); }
}

async function ok(client: Client, tool: string, args: Record<string, unknown>): Promise<any> {
  const r = await callJson(client, tool, args);
  expect(r.isError, `${tool}: ${JSON.stringify(r.body)}`).toBe(false);
  return r.body;
}

/**
 * One scope per write: add-time dedup merges similar entries of the same scope
 * and type, and the mock embeddings make all these texts look alike. Every
 * write must be a real insert, or "readable by the other side" proves nothing.
 */
const scopeOf = (tag: string) => `workspace:mcp-matrix-${tag}`;

async function addEntry(client: Client, tag: string): Promise<string> {
  const body = await ok(client, 'addKnowledge', {
    entries: { title: `Entry from ${tag}`, content: `Written by ${tag} through the MCP matrix smoke.`, tags: ['mcp-matrix'], type: 'pattern', scope: scopeOf(tag), source: 'mcp-matrix.test' },
  });
  const id: string = body.id ?? body.entry?.id ?? body[0]?.id ?? body.entries?.[0]?.id;
  expect(id, `addKnowledge id: ${JSON.stringify(body)}`).toBeTruthy();
  expect(JSON.stringify(body), 'a real insert, not a dedup update').not.toContain('"deduplicated":true');
  return id;
}

/** The four-tool smoke. Returns what it wrote so the other version can read it back. */
async function smoke(client: Client, tag: string): Promise<{ knowledgeId: string; planId: string; taskId: string }> {
  const knowledgeId = await addEntry(client, tag);
  expect(JSON.stringify(await ok(client, 'getKnowledge', { query: `Written by ${tag}` }))).toContain(knowledgeId);
  const plan = await ok(client, 'createPlan', {
    title: `Plan from ${tag}`, content: '## Context\nMCP matrix.', tags: ['mcp-matrix'], scope: scopeOf(tag), source: 'mcp-matrix.test',
    tasks: [{ description: `task from ${tag}` }],
  });
  const planId: string = plan.id;
  const taskId: string = (await ok(client, 'listPlanTasks', { planId })).tasks[0].id;
  await ok(client, 'updatePlanTask', { taskId, status: 'in_progress' });
  return { knowledgeId, planId, taskId };
}

/** Read `wrote` back with the current SDK (what the 2.6 app sees). */
async function readBackWithSdk(db: string, wrote: { knowledgeId: string; planId: string; taskId: string }) {
  const sdk = new KnowledgeSDK({ database: { path: db }, ollama: { host: `http://127.0.0.1:${mock.port}`, model: MODEL, dimensions: DEFAULT_EMBEDDING_DIMENSIONS } });
  await sdk.initialize();
  try {
    expect((await sdk.getKnowledgeById(wrote.knowledgeId))?.id).toBe(wrote.knowledgeId);
    expect(sdk.listPlanTasks(wrote.planId).find((t) => t.id === wrote.taskId)?.status).toBe('in_progress');
  } finally {
    await sdk.close();
  }
}

for (const v of NPM_VERSIONS) {
  test(`npm MCP ${v} works after upgrading the immutable legacy fixture`, async () => {
    needNpx();
    expect(npxInstalledVersions(NPX_SANDBOX)).toContain(v);
    const db = join(work, `legacy-${v}.db`);
    writeFileSync(db, gunzipSync(readFileSync(resolve(__dirname, '../../fixtures/upgrade/1.3.0-legacy.db.gz'))));
    const current = await withMcp(bundleLaunch(), db, (c) => smoke(c, `legacy-current-${v}`));
    const { sqlite } = createDbClient(db);
    try {
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('consumption_samples','consumption_ingest_state')").all()).toEqual([]);
      expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally { sqlite.close(); }
    const wrote = await withMcp(npxLaunch(v, NPX_SANDBOX), db, async (c) => {
      expect(JSON.stringify(await ok(c, 'getKnowledge', { query: `Written by legacy-current-${v}` }))).toContain(current.knowledgeId);
      return smoke(c, `legacy-npm-${v}`);
    });
    await readBackWithSdk(db, wrote);
  });

  test(`npm MCP ${v} (npx) works on a 2.6 database`, async () => {
    needNpx();
    expect(npxInstalledVersions(NPX_SANDBOX), 'npx resolved the published build').toContain(v);
    const db = join(work, `npm-${v}.db`);
    const from26 = await withMcp(bundleLaunch(), db, (c) => smoke(c, '2.6'));
    const fromNpm = await withMcp(npxLaunch(v, NPX_SANDBOX), db, async (c) => {
      // What 2.6 wrote is visible to the old server…
      expect(JSON.stringify(await ok(c, 'getKnowledge', { query: 'Written by 2.6' }))).toContain(from26.knowledgeId);
      return smoke(c, `npm-${v}`);
    });
    // …and what the old server wrote is visible to 2.6.
    await readBackWithSdk(db, fromNpm);
  });
}

test('MCP 2.6 works on a 2.5.4 database, and 2.5.4 still reads it afterwards', async () => {
  const db = join(work, 'fixture-2.5.4.db');
  writeFileSync(db, gunzipSync(readFileSync(FIXTURE_254)));
  const from26 = await withMcp(bundleLaunch(), db, async (c) => {
    // An entry the 2.5.4 SDK seeded is found by the 2.6 server.
    expect(JSON.stringify(await ok(c, 'getKnowledge', { query: 'quote the term or use the vector path' }))).toContain('c++');
    return smoke(c, '2.6-on-2.5.4');
  });
  needNpx();
  await withMcp(npxLaunch('2.5.4', NPX_SANDBOX), db, async (c) => {
    expect(JSON.stringify(await ok(c, 'getKnowledge', { query: 'Written by 2.6-on-2.5.4' }))).toContain(from26.knowledgeId);
    const tasks = await ok(c, 'listPlanTasks', { planId: from26.planId });
    expect(tasks.tasks[0].status).toBe('in_progress');
  });
});

test('the 2.6 app and the 2.5.x servers write to one database at the same time', async () => {
  needNpx();
  test.skip(!existsSync(SERVER_ENTRY), `built sidecar missing at ${SERVER_ENTRY} — run \`pnpm build\` first`);
  const db = join(work, 'shared.db');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const { child, readLog } = spawnSidecar({ ...sessionEnv(db), DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN });
  const sidecar: ChildProcess = child;
  const clients: Client[] = [];
  try {
    if (!(await waitForSidecar(baseUrl))) throw new Error(`sidecar never became ready.\n${readLog()}`);
    for (const v of NPM_VERSIONS) clients.push(await connectMcp(npxLaunch(v, NPX_SANDBOX), sessionEnv(db)));

    const appAdd = async (i: number): Promise<string> => {
      const r = await authFetch(`${baseUrl}/api/knowledge`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `App entry ${i}`, content: `Written by the 2.6 app, burst ${i}.`, tags: ['mcp-matrix'], type: 'pattern', scope: scopeOf(`app-${i}`), source: 'mcp-matrix.test' }),
      });
      expect(r.status, await r.clone().text()).toBe(200);
      return ((await r.json()) as { id: string }).id;
    };
    const N = 6;
    // Everyone writes at once: the app's requests in parallel, each server in sequence.
    const [appIds, ...mcpIds] = await Promise.all([
      Promise.all(Array.from({ length: N }, (_, i) => appAdd(i))),
      ...clients.map(async (c, k) => {
        const ids: string[] = [];
        for (let i = 0; i < N; i++) ids.push(await addEntry(c, `npm-${NPM_VERSIONS[k]}-burst-${i}`));
        return ids;
      }),
    ]);
    const all = [...appIds, ...mcpIds.flat()];
    expect(new Set(all).size).toBe(N * (1 + clients.length));

    // Each side reads the others' writes.
    const search = await authFetch(`${baseUrl}/api/knowledge/search`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'Written by npm-2.5.3-burst-0 through the MCP matrix smoke', limit: 50, threshold: 0 }),
    });
    expect(search.status).toBe(200);
    expect(JSON.stringify(await search.json())).toContain(mcpIds[0][0]);
    for (const c of clients) {
      expect(JSON.stringify(await ok(c, 'getKnowledge', { query: 'Written by the 2.6 app, burst 0' }))).toContain(appIds[0]);
    }
    for (const id of all) expect((await authFetch(`${baseUrl}/api/knowledge/${id}`)).status, id).toBe(200);
    expect(readLog()).not.toMatch(/SQLITE_BUSY|database is locked/);
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    await stopSidecar(sidecar);
  }
});
