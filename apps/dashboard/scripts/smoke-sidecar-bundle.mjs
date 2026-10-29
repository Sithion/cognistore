#!/usr/bin/env node
/**
 * Smoke test of the packaged sidecar (plan v2.6, T.11).
 *
 *   node scripts/smoke-sidecar-bundle.mjs [bundleDir]   # default: ./sidecar-bundle
 *
 * Runs what `bundle-sidecar.mjs` produced the way the desktop app does, without
 * building the AppImage/deb: the bundle is copied to a fresh temp directory laid
 * out like the app's Resources (so nothing can resolve from the monorepo's
 * node_modules), and `node dist-server/index.js` is spawned with the env of
 * `spawn_node` in src-tauri/src/sidecar.rs. HOME is a sandbox and a stub Ollama
 * answers the embeddings, so it installs and touches nothing.
 *
 * Checks, in order:
 *   1. the ready marker the Tauri shell waits for appears on stdout;
 *   2. /api/health reports the database connected;
 *   3. an entry added over the API is found again by a semantic search, which
 *      only works when the sqlite-vec extension loaded from the bundled
 *      node_modules (better-sqlite3 rebuilt for the runtime's ABI).
 * Exits non-zero, printing the sidecar's output, on the first failure.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundleDir = resolve(process.argv[2] ?? join(__dirname, '..', 'sidecar-bundle'));
const READY_MARKER = 'COGNISTORE_SIDECAR_READY'; // src-tauri/src/sidecar.rs
const NATIVE_DIMS = 768; // nomic-embed-text; the sidecar truncates to 256
const TIMEOUT_MS = 60_000;
const REQUIRED_NODE_MAJOR = 24; // bundle-sidecar.mjs rebuilds better-sqlite3 for this ABI

if (Number(process.versions.node.split('.')[0]) !== REQUIRED_NODE_MAJOR) {
  console.error(`run with Node ${REQUIRED_NODE_MAJOR} (the bundle's native ABI); this is ${process.versions.node}`);
  process.exit(1);
}

for (const part of ['dist', 'dist-server/index.js', 'node_modules/better-sqlite3', 'node_modules/sqlite-vec', 'templates']) {
  if (!existsSync(join(bundleDir, part))) {
    console.error(`bundle incomplete: ${join(bundleDir, part)} is missing — run scripts/bundle-sidecar.mjs first`);
    process.exit(1);
  }
}

const root = mkdtempSync(join(tmpdir(), 'cognistore-bundle-smoke-'));
const resources = join(root, 'Resources');
const home = join(root, 'home');
cpSync(bundleDir, resources, { recursive: true });

/** Deterministic unit vector per prompt, so the same text embeds identically. */
function embed(prompt) {
  const v = new Array(NATIVE_DIMS).fill(0);
  for (let i = 0; i < prompt.length; i++) v[i % NATIVE_DIMS] += prompt.charCodeAt(i) / 1000;
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

const ollama = createServer((req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/api/tags')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ models: [{ name: 'nomic-embed-text' }] }));
  }
  if (req.method === 'POST' && req.url?.startsWith('/api/embeddings')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let prompt = '';
      try { prompt = JSON.parse(raw).prompt ?? ''; } catch { /* empty prompt */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ embedding: embed(prompt) }));
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => ollama.listen(0, '127.0.0.1', r));

const port = await new Promise((r) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});
const token = randomBytes(16).toString('hex');
const base = `http://127.0.0.1:${port}`;

let log = '';
let child;
function fail(msg) {
  console.error(`FAIL: ${msg}\n--- sidecar output ---\n${log}`);
  cleanup(1);
}
// Anything that throws (a refused fetch, a non-JSON body) or a Ctrl-C still
// prints the log, kills the sidecar and removes the temp dir.
process.on('uncaughtException', (e) => fail(String(e?.stack ?? e)));
process.on('unhandledRejection', (e) => fail(String(e?.stack ?? e)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup(130));
function cleanup(code) {
  try { child?.kill('SIGKILL'); } catch { /* gone */ }
  ollama.close();
  rmSync(root, { recursive: true, force: true });
  process.exit(code);
}

// The env of spawn_node (sidecar.rs), except OLLAMA_HOST (the stub) and
// COGNISTORE_MANAGED, which would let the startup self-heal write agent configs.
child = spawn(process.execPath, [join(resources, 'dist-server', 'index.js')], {
  cwd: root,
  env: {
    PATH: process.env.PATH,
    HOME: home,
    SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'),
    OLLAMA_HOST: `http://127.0.0.1:${ollama.address().port}`,
    OLLAMA_MODEL: 'nomic-embed-text',
    EMBEDDING_DIMENSIONS: '256',
    DASHBOARD_PORT: String(port),
    DASHBOARD_DIST_PATH: join(resources, 'dist'),
    TEMPLATES_PATH: join(resources, 'templates'),
    NODE_ENV: 'production',
    NODE_PATH: join(resources, 'node_modules'),
    SIDECAR_TOKEN: token,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
child.on('exit', (code, signal) => fail(`sidecar exited early (code ${code}, signal ${signal})`));
const timer = setTimeout(() => fail(`timed out after ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);

const api = (path, init = {}) => fetch(`${base}${path}`, {
  ...init,
  headers: { 'content-type': 'application/json', 'x-cognistore-token': token, ...init.headers },
});

// 1. Ready marker.
while (!log.includes(READY_MARKER)) await new Promise((r) => setTimeout(r, 200));
console.log('ok   ready marker on stdout');

// 2. Health: the SDK initializes after listen, so poll until the database is up.
let health;
for (;;) {
  try { health = await (await api('/api/health')).json(); } catch { /* not up yet */ }
  if (health?.database?.connected === true) break;
  // Before init the error reads 'Not initialized'; anything else is a failed init
  // (e.g. sqlite-vec's native extension missing from the bundle).
  const initError = health?.database?.error;
  if (initError && initError !== 'Not initialized') fail(`database did not open: ${initError}`);
  await new Promise((r) => setTimeout(r, 300));
}
console.log('ok   /api/health: database connected');

// 3. sqlite-vec: add, then find it by meaning.
const content = 'Bundle smoke: the packaged sidecar loads sqlite-vec from its own node_modules.';
const created = await api('/api/knowledge', {
  method: 'POST',
  body: JSON.stringify({ title: 'Bundle smoke', content, tags: ['smoke'], type: 'pattern', scope: 'global', source: 'bundle-smoke' }),
});
if (created.status !== 201 && created.status !== 200) fail(`POST /api/knowledge → ${created.status} ${await created.text()}`);
const { id } = await created.json();
// The query is the exact text the service embeds (title + content + tags), so the
// semantic part is ~1. The score is 0.7·semantic + 0.3·keyword: a keyword-only
// hit (vector search broken) tops out at 0.3.
const query = `Bundle smoke ${content} smoke`;
const search = await api('/api/knowledge/search', { method: 'POST', body: JSON.stringify({ query }) });
if (!search.ok) fail(`POST /api/knowledge/search → ${search.status} ${await search.text()}`);
const body = await search.json();
const hits = Array.isArray(body) ? body : body.results ?? [];
const hit = hits.find((h) => (h.entry?.id ?? h.id) === id);
if (!hit) fail(`the new entry was not found by search: ${JSON.stringify(body).slice(0, 500)}`);
if (!(hit.similarity > 0.6)) fail(`score ${hit.similarity} — no semantic match, vector search did not run`);
console.log(`ok   sqlite-vec: added entry found by semantic search (score ${hit.similarity.toFixed(3)})`);

clearTimeout(timer);
child.removeAllListeners('exit');
console.log('PASS sidecar bundle smoke');
cleanup(0);
