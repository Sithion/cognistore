import { test, expect } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SERVER_ENTRY, TEST_TOKEN, TOKEN_HEADER, fakeEmbedding, getFreePort, spawnSidecar, stopSidecar, waitForSidecar,
} from '../sidecar-helpers.js';

/**
 * Sidecar API suite (plan v2.6, T.7).
 *
 * The route list comes from Fastify itself: with COGNISTORE_ROUTE_MANIFEST set
 * the sidecar writes every registered route to a file. Then:
 *   - every /api route must be named by some test under packages/tests/src —
 *     a new route without a test fails here, listed by method and path;
 *   - auth/CSRF is swept over EVERY route: no token → 403, foreign Origin → 403;
 *   - validation (4xx), the error handler (5xx), body and page limits;
 *   - the routes no other suite exercised get a functional call each.
 *
 * Runs in a sandboxed HOME with a fake `ollama` and a fake nvm Node first, so
 * the setup routes take their "already installed" paths and install nothing.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_SRC = resolve(__dirname, '..');
const UUID = '00000000-0000-4000-8000-000000000000';

type Route = { method: string; url: string };

let home: string;
let base: string;
let port: number;
let child: ChildProcess | undefined;
let readLog: () => string;
let mock: { server: Server; port: number };

/** A prompt containing this makes the mock Ollama answer 500 (an upstream failure). */
const OLLAMA_FAIL = '__mock_ollama_fail__';

/** Mock Ollama (tags, embeddings, pull) that can fail on demand. */
function startFailableOllama(model: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/api/tags')) return void res.end(JSON.stringify({ models: [{ name: model }] }));
      if (req.url?.startsWith('/api/pull')) return void res.end(JSON.stringify({ status: 'success' }) + '\n');
      if (req.url?.startsWith('/api/embeddings')) {
        let prompt = '';
        try { prompt = JSON.parse(raw).prompt ?? ''; } catch { /* empty */ }
        if (prompt.includes(OLLAMA_FAIL)) { res.statusCode = 500; return void res.end('{"error":"mock failure"}'); }
        return void res.end(JSON.stringify({ embedding: fakeEmbedding(prompt) }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: (server.address() as { port: number }).port })));
}
let routes: Route[];

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  test.skip(!existsSync(SERVER_ENTRY), `built sidecar missing at ${SERVER_ENTRY} — run \`pnpm build\` first`);
  home = mkdtempSync(join(tmpdir(), 'cognistore-api-'));
  // Fake `ollama` (records calls, never pulls or serves) and a fake nvm Node 24.
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ollama'), `#!/bin/sh\necho "$@" >> "${join(home, 'ollama-calls.log')}"\nexit 0\n`);
  chmodSync(join(bin, 'ollama'), 0o755);
  const nvmNode = join(home, '.nvm', 'versions', 'node', 'v24.0.0', 'bin');
  mkdirSync(nvmNode, { recursive: true });
  writeFileSync(join(nvmNode, 'node'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(nvmNode, 'node'), 0o755);

  mock = await startFailableOllama('nomic-embed-text');
  port = await getFreePort();
  base = `http://127.0.0.1:${port}`;
  const manifest = join(home, 'routes.json');
  const spawned = spawnSidecar({
    HOME: home,
    PATH: `${bin}:${process.env.PATH}`,
    SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'),
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
    OLLAMA_MODEL: 'nomic-embed-text',
    DASHBOARD_PORT: String(port),
    SIDECAR_TOKEN: TEST_TOKEN,
    COGNISTORE_ROUTE_MANIFEST: manifest,
  });
  child = spawned.child;
  readLog = spawned.readLog;
  if (!(await waitForSidecar(base))) throw new Error(`sidecar never became ready.\n${readLog()}`);
  routes = (JSON.parse(readFileSync(manifest, 'utf-8')) as Route[])
    .filter((r) => r.url.startsWith('/api/') && r.method !== 'HEAD' && r.method !== 'OPTIONS');
});

test.afterAll(async () => {
  await stopSidecar(child);
  await new Promise<void>((r) => (mock ? mock.server.close(() => r()) : r()));
  if (home) rmSync(home, { recursive: true, force: true });
});

/** Authenticated JSON call. `headers` can drop or override the token. */
async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      [TOKEN_HEADER]: TEST_TOKEN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

const fill = (url: string) => url.replace(/:[^/]+/g, UUID);

// ─── Inventory ───────────────────────────────────────────────────────

test('the route inventory comes from Fastify and is complete', () => {
  // One route of each registrar: index.ts and cleanup-routes.ts.
  expect(routes.length).toBeGreaterThan(60);
  for (const known of ['GET /api/health', 'POST /api/knowledge', 'GET /api/plans', 'POST /api/cleanup/candidates/:id/dismiss']) {
    expect(routes.map((r) => `${r.method} ${r.url}`)).toContain(known);
  }
});

test('every /api route is exercised by some test', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []);
  const source = walk(TESTS_SRC).map((f) => readFileSync(f, 'utf-8')).join('\n');
  // A `:param` segment matches a literal or a `${…}` interpolation; the path must
  // end there (so /api/plans does not count for /api/plans/:id/open).
  const seg = String.raw`(?:\$\{[^}]+\}|[^/'"\x60?\s)]+)`;
  const pattern = (url: string) => new RegExp(
    url.split('/').map((p) => p.startsWith(':') ? seg : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + String.raw`(?![\w/-])`,
  );
  const untested = routes.filter((r) => !pattern(r.url).test(source)).map((r) => `${r.method} ${r.url}`);
  expect(untested, 'routes with no test — add one (this file is the place for a plain call)').toEqual([]);
});

// ─── Auth / CSRF, over every route ───────────────────────────────────

test('every route refuses a caller without the token', async () => {
  const leaks: string[] = [];
  for (const r of routes) {
    const res = await api(r.method, fill(r.url), r.method === 'GET' ? undefined : {}, { [TOKEN_HEADER]: '' });
    const expected = r.url === '/api/health' ? 200 : 403; // liveness only, carries no data
    if (res.status !== expected) leaks.push(`${r.method} ${r.url} → ${res.status}`);
  }
  expect(leaks).toEqual([]);
});

test('every route refuses a foreign Origin even with the token (CSRF)', async () => {
  const leaks: string[] = [];
  for (const r of routes) {
    const res = await api(r.method, fill(r.url), r.method === 'GET' ? undefined : {}, { origin: 'https://evil.example' });
    if (res.status !== 403) leaks.push(`${r.method} ${r.url} → ${res.status}`);
  }
  expect(leaks).toEqual([]);
});

test('an unknown /api path is refused without the token and 404 with it', async () => {
  expect((await api('GET', '/api/no-such-route', undefined, { [TOKEN_HEADER]: '' })).status).toBe(403);
  expect((await api('GET', '/api/no-such-route')).status).toBe(404);
});

// ─── Pagination and limits ───────────────────────────────────────────

test('knowledge and plan listings clamp limit (1…200) and offset (≥ 0)', async () => {
  const knowledge = Array.from({ length: 205 }, (_, i) => ({
    title: `Paged entry ${i}`, content: `Pagination fixture number ${i}.`, tags: ['paging'], type: 'pattern', scope: `workspace:paging-${i}`,
  }));
  const imported = await api('POST', '/api/import', { include: ['knowledge'], knowledge });
  expect(imported.status, JSON.stringify(imported.body)).toBe(200);
  // No `source` on purpose: the import schema makes it optional.
  expect(imported.body.knowledge).toMatchObject({ imported: 205, errors: [] });

  const recent = async (qs: string) => {
    const r = await api('GET', `/api/knowledge/recent?${qs}`);
    expect(r.status).toBe(200);
    return r.body as { id: string }[];
  };
  expect((await recent('limit=1000')).length).toBe(200);
  expect((await recent('limit=0')).length).toBe(20); // 0/garbage → the default
  expect((await recent('limit=abc')).length).toBe(20);
  expect((await recent('limit=-3')).length).toBe(1);
  const page1 = await recent('limit=100&offset=0');
  const page2 = await recent('limit=100&offset=100');
  const page3 = await recent('limit=100&offset=200');
  expect(page3.length).toBe(205 - 200);
  const ids = [...page1, ...page2, ...page3].map((e) => e.id);
  expect(new Set(ids).size).toBe(205); // disjoint pages covering everything
  expect((await recent('limit=5&offset=-50')).map((e) => e.id)).toEqual(page1.slice(0, 5).map((e) => e.id));

  for (let i = 0; i < 3; i++) {
    const p = await api('POST', '/api/plans', { title: `Paged plan ${i}`, content: `Plan ${i}`, tags: ['paging'], scope: `workspace:paging-plan-${i}`, source: 'api-test' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
  }
  const plans = async (qs: string) => {
    const r = await api('GET', `/api/plans?${qs}`);
    expect(r.status).toBe(200);
    return (Array.isArray(r.body) ? r.body : r.body.plans) as { id: string }[];
  };
  expect((await plans('limit=-1')).length).toBe(1);
  const [a, b] = [await plans('limit=1&offset=0'), await plans('limit=1&offset=1')];
  expect(a[0].id).not.toBe(b[0].id);
});

test('bodies over the 1 MiB limit are refused with 413', async () => {
  const r = await api('POST', '/api/knowledge', { title: 'big', content: 'x'.repeat(1_100_000), tags: [], type: 'pattern', scope: 'global' });
  expect(r.status).toBe(413);
});

// ─── 4xx and 5xx ─────────────────────────────────────────────────────

test('invalid input is a 4xx, never a 5xx', async () => {
  const cases: [string, string, unknown, number][] = [
    ['POST', '/api/knowledge', '{"not json', 400],
    ['POST', '/api/knowledge/search', {}, 400],
    ['POST', '/api/knowledge', { title: 'no source', content: 'c', tags: ['t'], type: 'pattern', scope: 'global' }, 400],
    ['DELETE', '/api/knowledge/bulk', { ids: [] }, 400],
    ['DELETE', '/api/knowledge/bulk', { ids: ['not-a-uuid'] }, 400],
    ['DELETE', '/api/knowledge/bulk', { ids: Array.from({ length: 1001 }, () => UUID) }, 400],
    ['POST', `/api/plans/${UUID}/relations`, { knowledgeId: 'x', relationType: 'input' }, 400],
    ['POST', `/api/plans/${UUID}/relations`, { knowledgeId: UUID, relationType: 'sideways' }, 400],
    ['GET', '/api/token-usage', undefined, 400],
    ['POST', '/api/tags/merge', { from: ' ', to: 'x' }, 400],
    ['POST', '/api/import', { include: ['knowledge'], knowledge: [{ content: 'no type or scope' }] }, 400],
    ['GET', `/api/knowledge/${UUID}`, undefined, 404],
    ['PUT', `/api/knowledge/${UUID}`, { content: 'nobody' }, 404],
    ['POST', `/api/plans/${UUID}/open`, undefined, 404],
    ['POST', `/api/cleanup/candidates/${UUID}/dismiss`, undefined, 404],
    ['PUT', '/api/providers/no-such-provider', { name: 'x' }, 404],
    ['POST', '/api/providers/no-such-provider/test', undefined, 404],
    ['POST', '/api/providers/no-such-provider/oauth/start', { redirectUri: 'http://127.0.0.1:1/cb' }, 404],
    ['POST', '/api/providers/no-such-provider/oauth/finish', { code: 'x' }, 409],
    ['POST', '/api/providers/no-such-provider/secret', {}, 400],
  ];
  const wrong: string[] = [];
  for (const [method, path, body, expected] of cases) {
    const r = await api(method, path, body);
    if (r.status !== expected) wrong.push(`${method} ${path} → ${r.status} (want ${expected}): ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  expect(wrong).toEqual([]);
});

test('a server-side failure is a 5xx with a correlation id, logged server-side', async () => {
  // Ollama failing while embedding a new entry: not the caller's fault.
  const r = await api('POST', '/api/knowledge', { title: 'x', content: `fails ${OLLAMA_FAIL}`, tags: ['t'], type: 'pattern', scope: 'global', source: 'api-test' });
  expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(500);
  expect(r.body).toEqual({ error: expect.any(String), ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
  expect(readLog()).toContain(`[${r.body.ref}]`);
});

// ─── Routes no other suite exercised ─────────────────────────────────

test('metrics, scopes, tags and token-usage reads answer', async () => {
  for (const path of [
    '/api/metrics', '/api/metrics/top-tags?limit=5', '/api/metrics/by-type', '/api/metrics/by-scope',
    '/api/metrics/by-agent', '/api/metrics/by-platform', '/api/scopes', '/api/health/stale?limit=5',
    '/api/tags/suggestions', `/api/token-usage?from=2026-01-01&to=2026-12-31`,
  ]) {
    const r = await api('GET', path);
    expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  }
  const scopes = await api('GET', '/api/scopes');
  expect(JSON.stringify(scopes.body)).toContain('workspace:paging-0');
  const top = await api('GET', '/api/metrics/top-tags?limit=5');
  expect(JSON.stringify(top.body)).toContain('paging');
});

test('tag merge, plan relations and bulk delete', async () => {
  const add = async (title: string, tags: string[]) => {
    const r = await api('POST', '/api/knowledge', { title, content: `${title} content`, tags, type: 'decision', scope: `workspace:api-${title}`, source: 'api-test' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.id as string;
  };
  const k1 = await add('first', ['old-tag']);
  const k2 = await add('second', ['old-tag']);

  const merged = await api('POST', '/api/tags/merge', { from: 'old-tag', to: 'new-tag' });
  expect(merged.status).toBe(200);
  expect((await api('GET', `/api/knowledge/${k1}`)).body.tags).toEqual(['new-tag']);

  const plan = await api('POST', '/api/plans', { title: 'Relations plan', content: 'r', tags: ['relations'], scope: 'workspace:api-relations', source: 'api-test' });
  const planId = plan.body.id as string;
  expect((await api('POST', `/api/plans/${planId}/relations`, { knowledgeId: k1, relationType: 'input' })).status).toBe(200);
  const rel = await api('GET', `/api/plans/${planId}/relations`);
  expect(rel.status).toBe(200);
  expect(JSON.stringify(rel.body)).toContain(k1);
  const forK = await api('GET', `/api/knowledge/${k1}/plans`);
  expect(forK.status).toBe(200);
  expect(JSON.stringify(forK.body)).toContain(planId);

  // A plan with no file on disk has nothing to open.
  expect((await api('POST', `/api/plans/${planId}/open`)).status).toBe(404);

  const del = await api('DELETE', '/api/knowledge/bulk', { ids: [k1, k2] });
  expect(del.status, JSON.stringify(del.body)).toBe(200);
  expect((await api('GET', `/api/knowledge/${k2}`)).status).toBe(404);
});

test('a provider can be edited, given a secret, tested and removed', async () => {
  const entry = { id: 'api-test', name: 'API test', transport: 'http', url: 'http://127.0.0.1:9/mcp' };
  const created = await api('POST', '/api/providers', entry);
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  // PUT replaces the whole entry (it is re-validated, not merged).
  expect((await api('PUT', '/api/providers/api-test', { name: 'partial' })).status).toBe(400);
  const renamed = await api('PUT', '/api/providers/api-test', { ...entry, name: 'API test (renamed)' });
  expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
  expect(renamed.body.name).toBe('API test (renamed)');
  expect((await api('POST', '/api/providers/api-test/secret', { value: 'not-a-real-secret' })).body).toEqual({ ok: true });
  // Nothing listens on port 9: the test reports failure, it does not throw.
  const tested = await api('POST', '/api/providers/api-test/test');
  expect([200, 403], JSON.stringify(tested.body)).toContain(tested.status);
  if (tested.status === 200) expect(tested.body.ok).toBe(false);
  // Not an OAuth provider; and no flow was started.
  expect((await api('POST', '/api/providers/api-test/oauth/start', { redirectUri: 'http://127.0.0.1:1/cb' })).status).toBe(400);
  expect((await api('POST', '/api/providers/api-test/oauth/finish', { code: 'x' })).status).toBe(409);
  expect((await api('DELETE', '/api/providers/api-test')).status).toBe(200);
  expect((await api('PUT', '/api/providers/api-test', { ...entry, name: 'gone' })).status).toBe(404);
});

test('the setup steps take their already-installed paths and install nothing', async () => {
  const node = await api('POST', '/api/setup/node');
  expect(node.body).toMatchObject({ success: true });
  expect(node.body.path).toContain(home);
  expect((await api('POST', '/api/setup/ollama')).body).toEqual({ success: true, message: 'Already installed' });
  expect((await api('POST', '/api/setup/model')).body).toMatchObject({ success: true });
  const db = await api('POST', '/api/setup/database');
  expect(db.body, JSON.stringify(db.body)).toMatchObject({ success: true });
  expect(existsSync(join(home, '.cognistore', 'knowledge.db'))).toBe(true);
  expect((await api('POST', '/api/setup/complete')).body).toMatchObject({ success: true, sdkReady: true });
  // ollama-start polls the fixed local Ollama port: whatever runs there decides
  // success, but the route answers either way and only ever runs `ollama serve`.
  const start = await api('POST', '/api/setup/ollama-start');
  expect(start.status).toBe(200);
  expect(typeof start.body.success).toBe('boolean');
  const calls = (existsSync(join(home, 'ollama-calls.log')) ? readFileSync(join(home, 'ollama-calls.log'), 'utf-8') : '')
    .split('\n').filter(Boolean);
  // Unless an Ollama already answered, the route must have run OUR fake — a
  // real `ollama` ahead of it on PATH (e.g. Homebrew's) would have been spawned.
  if (start.body.message !== 'Already running') expect(calls).toContain('serve');
  expect(calls.every((c) => c === 'serve')).toBe(true);
});
