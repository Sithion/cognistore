#!/usr/bin/env node
/**
 * Read-only health report for a CogniStore database.
 *
 *   node scripts/diagnose-db.mjs [path/to/knowledge.db] [--json]
 *
 * Default path: $SQLITE_PATH or ~/.cognistore/knowledge.db.
 * Opens the file READ-ONLY and never loads sqlite-vec, so it is safe to run
 * while the app is open. vec0 virtual tables are measured through their shadow
 * tables (`*_rowids`, `*_vector_chunks00`).
 *
 * Used by Phase 0 of documentation/plans/2026-11-performance-e-curadoria.md.
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// better-sqlite3 is a dependency of @cognistore/core, not of the workspace
// root (pnpm is strict), so resolve it from there.
const require = createRequire(resolve(here, '../packages/core/package.json'));
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const pathArg = args.find((a) => !a.startsWith('--'));
const dbPath = (pathArg ?? process.env.SQLITE_PATH ?? '~/.cognistore/knowledge.db').replace(/^~/, homedir());

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const report = { path: dbPath, files: {}, pragmas: {}, objects: [], counts: {}, knowledge: {}, telemetry: {}, cleanup: {}, timingsMs: {} };

const time = (label, fn) => {
  const t = performance.now();
  try { return fn(); } finally { report.timingsMs[label] = +(performance.now() - t).toFixed(1); }
};
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
const one = (sql, ...p) => safe(() => db.prepare(sql).get(...p));
const all = (sql, ...p) => safe(() => db.prepare(sql).all(...p), []);
const tableExists = (n) => !!one(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, n);

for (const suffix of ['', '-wal', '-shm']) {
  const f = dbPath + suffix;
  if (existsSync(f)) report.files[`knowledge.db${suffix}`] = statSync(f).size;
}
// Only persistent, file-level pragmas: synchronous/cache_size/mmap_size are per
// connection and would describe THIS read-only connection, not the app's.
for (const p of ['page_size', 'page_count', 'freelist_count', 'journal_mode', 'auto_vacuum']) {
  report.pragmas[p] = safe(() => db.pragma(p, { simple: true }));
}

// Size per table/index (needs SQLITE_ENABLE_DBSTAT_VTAB, which better-sqlite3 ships with).
report.objects = time('dbstat', () => all(
  `SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 40`,
));

for (const { name } of all(`SELECT name FROM sqlite_master WHERE type='table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'`)) {
  report.counts[name] = one(`SELECT COUNT(*) AS n FROM "${name}"`)?.n ?? null;
}

if (tableExists('knowledge_entries')) {
  report.knowledge = {
    byType: all(`SELECT type, COUNT(*) AS n FROM knowledge_entries GROUP BY type ORDER BY n DESC`),
    topScopes: all(`SELECT scope, COUNT(*) AS n FROM knowledge_entries GROUP BY scope ORDER BY n DESC LIMIT 15`),
    byMonth: all(`SELECT substr(created_at,1,7) AS month, COUNT(*) AS n FROM knowledge_entries GROUP BY 1 ORDER BY 1`),
    content: one(`SELECT ROUND(AVG(length(content))) AS avgChars, MAX(length(content)) AS maxChars, SUM(length(content)) AS totalChars FROM knowledge_entries`),
    edited: one(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE version > 1`)?.n,
    readCountDistribution: all(`SELECT CASE WHEN read_count=0 THEN '0' WHEN read_count=1 THEN '1' WHEN read_count<10 THEN '2-9' ELSE '10+' END AS bucket, COUNT(*) AS n FROM knowledge_entries GROUP BY 1`),
    deprecatedTag: one(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value='deprecated')`)?.n,
    keepTag: one(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value='keep')`)?.n,
    supersededTitle: one(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE title LIKE '%SUPERSEDED%' OR title LIKE '%DEPRECATED%'`)?.n,
    exactDuplicateContent: one(`SELECT COALESCE(SUM(c - 1), 0) AS n FROM (SELECT COUNT(*) AS c FROM knowledge_entries GROUP BY content HAVING c > 1)`)?.n,
    notUpdated90d: one(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')`)?.n,
    embeddingDims: one(`SELECT sql FROM sqlite_master WHERE name='knowledge_embeddings'`)?.sql?.match(/float\[(\d+)\]/)?.[1] ?? null,
    embeddingRows: tableExists('knowledge_embeddings_rowids') ? one(`SELECT COUNT(*) AS n FROM knowledge_embeddings_rowids`)?.n : null,
  };
  // Cost of what the sidecar does today on every duplicate scan (listAll with full content).
  time('listAllFullContent', () => all(`SELECT * FROM knowledge_entries WHERE type != 'system' ORDER BY created_at DESC`).length);
}

if (tableExists('token_usage')) {
  report.telemetry.tokenUsage = {
    range: one(`SELECT MIN(occurred_at) AS first, MAX(occurred_at) AS last FROM token_usage`),
    byMonth: all(`SELECT substr(occurred_at,1,7) AS month, COUNT(*) AS n FROM token_usage GROUP BY 1 ORDER BY 1`),
    olderThan90d: one(`SELECT COUNT(*) AS n FROM token_usage WHERE occurred_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')`)?.n,
  };
  time('tokenUsageDailyAggregate', () => all(`SELECT date(occurred_at) d, SUM(input_tokens) FROM token_usage GROUP BY d`).length);
}
if (tableExists('operations_log')) {
  report.telemetry.operationsLog = all(`SELECT substr(created_at,1,7) AS month, COUNT(*) AS n FROM operations_log GROUP BY 1 ORDER BY 1`);
}
if (tableExists('cleanup_reports')) {
  report.cleanup = {
    reports: all(`SELECT id, created_at, status FROM cleanup_reports ORDER BY created_at DESC LIMIT 5`),
    candidates: all(`SELECT category, status, COUNT(*) AS n FROM cleanup_candidates GROUP BY 1, 2`),
    meta: all(`SELECT key, value FROM cleanup_meta`),
  };
}
db.close();

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
const totalBytes = report.objects.reduce((s, o) => s + o.bytes, 0) || 1;
console.log(`\nCogniStore DB diagnosis — ${report.path}`);
console.log('Files:', Object.entries(report.files).map(([k, v]) => `${k}=${mb(v)}`).join('  '));
console.log('Pragmas:', JSON.stringify(report.pragmas));
console.log('\nLargest objects:');
for (const o of report.objects.slice(0, 20)) {
  console.log(`  ${o.name.padEnd(48)} ${mb(o.bytes).padStart(10)}  ${((o.bytes / totalBytes) * 100).toFixed(1).padStart(5)}%`);
}
const telemetry = report.objects.filter((o) => /token_usage|operations_|scan_state/.test(o.name)).reduce((s, o) => s + o.bytes, 0);
console.log(`\nTelemetry share (token_usage/operations/scan_state): ${mb(telemetry)} (${((telemetry / totalBytes) * 100).toFixed(1)}%)`);
console.log('\nRow counts:', JSON.stringify(report.counts));
const section = (title, obj) => {
  console.log(`\n${title}:`);
  for (const [k, v] of Object.entries(obj ?? {})) console.log(`  ${k}: ${JSON.stringify(v)}`);
};
section('Knowledge', report.knowledge);
section('Telemetry', report.telemetry);
section('Cleanup', report.cleanup);
console.log('\nTimings (ms):', JSON.stringify(report.timingsMs));
