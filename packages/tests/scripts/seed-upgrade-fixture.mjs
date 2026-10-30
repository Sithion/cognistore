#!/usr/bin/env node
/**
 * Seeds ONE upgrade fixture with the SDK of a past release (plan v2.6, T.3).
 * Run by gen-upgrade-fixtures.mjs, never by hand:
 *
 *   node seed-upgrade-fixture.mjs <worktree> <out.db>
 *
 * <worktree> is a checkout of the release, already built. Its own SDK writes
 * the data, so every row has the shape that release really wrote. The env must
 * point HOME at a sandbox: the token scanner reads <HOME>/.claude/projects.
 * Embeddings come from an in-process mock Ollama; no real Ollama is touched.
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [worktree, outDb] = process.argv.slice(2);
if (!worktree || !outDb) {
  console.error('usage: seed-upgrade-fixture.mjs <worktree> <out.db>');
  process.exit(2);
}

// The release's own defaults. 0.x used a 384-d model and required an exact
// match; later releases ask nomic-embed-text for 768 and truncate (Matryoshka).
const shared = await import(pathToFileURL(join(worktree, 'packages/shared/dist/index.js')).href);
const MODEL = shared.DEFAULT_EMBEDDING_MODEL ?? shared.DEFAULT_OLLAMA_MODEL ?? 'nomic-embed-text';
const DIMS = shared.DEFAULT_EMBEDDING_DIMENSIONS === 384 ? 384 : 768;

/** Deterministic unit vector from the text (same idea as sidecar-helpers' fakeEmbedding). */
function embed(text) {
  const v = new Array(DIMS).fill(0);
  for (let i = 0; i < text.length; i++) v[i % DIMS] += text.charCodeAt(i) / 1000;
  const m = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / m);
}

const ollama = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/tags')) return res.end(JSON.stringify({ models: [{ name: `${MODEL}:latest` }, { name: MODEL }] }));
    if (req.url.startsWith('/api/pull')) return res.end(JSON.stringify({ status: 'success' }) + '\n');
    let body = {};
    try { body = JSON.parse(raw); } catch { /* empty */ }
    if (req.url.startsWith('/api/embeddings')) return res.end(JSON.stringify({ embedding: embed(body.prompt ?? '') }));
    if (req.url.startsWith('/api/embed')) {
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ''];
      return res.end(JSON.stringify({ embeddings: inputs.map(embed) }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
process.env.OLLAMA_HOST = `http://127.0.0.1:${ollama.address().port}`;
process.env.SQLITE_PATH = resolve(outDb);

// Claude Code–style session logs for releases that have the token scanner.
const projects = join(process.env.HOME, '.claude', 'projects', '-home-user-Projects-fixture');
mkdirSync(projects, { recursive: true });
const lines = [];
for (let i = 0; i < 24; i++) {
  const timestamp = new Date(Date.UTC(2026, 3, 1 + (i % 20), 9 + (i % 8))).toISOString();
  lines.push(JSON.stringify({ type: 'user', timestamp, sessionId: 'fixture-session-1', message: { role: 'user', content: 'hi' } }));
  lines.push(JSON.stringify({
    type: 'assistant', timestamp, sessionId: 'fixture-session-1', uuid: `fixture-${i}`,
    message: {
      id: `msg_fixture_${i}`, model: i % 2 ? 'claude-sonnet-4-5' : 'claude-opus-4-1',
      usage: { input_tokens: 1000 + i, output_tokens: 200 + i, cache_read_input_tokens: 5000 + i, cache_creation_input_tokens: 300 + i },
    },
  }));
}
writeFileSync(join(projects, 'fixture-session-1.jsonl'), lines.join('\n') + '\n');

const { KnowledgeSDK } = await import(pathToFileURL(join(worktree, 'packages/sdk/dist/index.js')).href);
const sdk = new KnowledgeSDK();
await sdk.initialize();
const has = (m) => typeof sdk[m] === 'function';

/** Realistic, varied entries: every type, several scopes, unicode, a long body. */
const ENTRIES = [
  ['pattern', 'global', ['sqlite', 'wal'], 'SQLite WAL with one writer', 'Use WAL mode and keep one writer; readers never block. Checkpoint on close.'],
  ['decision', 'workspace:fixture-app', ['architecture'], 'Sidecar owns the database', 'The Fastify sidecar is the only long-lived writer; MCP servers open the same file per session.'],
  ['fix', 'workspace:fixture-app', ['migrations', 'bug'], 'Never reuse a migration version key', 'A changed DDL behind an applied version never reaches existing installs. Add a new key with IF NOT EXISTS.'],
  ['constraint', 'global', ['node'], 'Node 24 required', 'The native addons are built for Node 24; older majors fail to load better-sqlite3.'],
  ['gotcha', 'workspace:fixture-app', ['fts5', 'search'], 'FTS5 tokenizer drops punctuation', 'Searching for "c++" matches "c"; quote the term or use the vector path.'],
  ['pattern', 'workspace:other-project', ['react', 'hooks'], 'Derive state, do not sync it', 'Compute values from props during render instead of copying them into state with an effect.'],
  ['decision', 'global', ['i18n'], 'Mensagens em português e inglês', 'Toda chave de i18n existe em pt e en; acentuação preservada: ação, coração, útil. 日本語 também é aceito.'],
  ['fix', 'global', ['shell', 'quoting'], 'Quote paths with spaces', 'Use execFile with an argument array; never interpolate a path into a shell string.'],
  ['pattern', 'workspace:fixture-app', ['testing', 'long'], 'Long-form testing notes', 'Integration tests boot the real server against a temporary database. '.repeat(60)],
  ['gotcha', 'global', ['ollama'], 'Ollama model names carry tags', 'nomic-embed-text and nomic-embed-text:latest are the same model; compare without the tag.'],
  ['constraint', 'workspace:other-project', ['security'], 'Tokens never reach logs', 'Log the SQL text, never the bound values.'],
  ['decision', 'workspace:fixture-app', ['to-delete'], 'Entry deleted before the upgrade', 'This entry is deleted by the seed; it must not come back after the upgrade.'],
];

const ids = [];
for (const [type, scope, tags, title, content] of ENTRIES) {
  const input = { type, scope, tags, title, content, source: 'upgrade-fixture' };
  let entry;
  try {
    entry = await sdk.addKnowledge(input);
  } catch (e) {
    // Defensive: a release whose schema rejects the field. (0.8.0 has no
    // title column either, but it silently drops the title instead.)
    const { title: _t, ...noTitle } = input;
    entry = await sdk.addKnowledge({ ...noTitle, content: `${title}\n\n${content}` });
  }
  ids.push(entry.id);
}
if (has('updateKnowledge')) await sdk.updateKnowledge(ids[0], { content: 'Use WAL mode and keep one writer; readers never block. Checkpoint on close. (updated once)' });
if (has('deleteKnowledge')) await sdk.deleteKnowledge(ids[ids.length - 1]);

if (has('createPlan')) {
  const plan = await sdk.createPlan({
    title: 'Fixture plan: migrate the cache', content: '## Context\nMove the cache to SQLite.\n## Approach\nOne table, one writer.',
    tags: ['fixture', 'plan'], scope: 'workspace:fixture-app', source: 'upgrade-fixture',
    relatedKnowledgeIds: [ids[0], ids[1]],
    tasks: [{ description: 'Create the table', priority: 'high' }, { description: 'Backfill rows' }, { description: 'Drop the old cache', priority: 'low' }],
  });
  if (has('addPlanRelation')) await sdk.addPlanRelation(plan.id, ids[2], 'output');
  await sdk.createPlan({
    title: 'Second fixture plan', content: '## Context\nDocs only.', tags: ['docs'], scope: 'workspace:other-project', source: 'upgrade-fixture',
    tasks: [{ description: 'Write the README section' }],
  });
}

// Reads leave operations_log rows and read counters behind, like real use.
for (const q of ['sqlite writer', 'migration version', 'tokenizer punctuation']) await sdk.getKnowledge(q);
if (has('scanTokenUsage')) await sdk.scanTokenUsage();

await sdk.close();
ollama.close();
console.log(`seeded ${outDb}`);
