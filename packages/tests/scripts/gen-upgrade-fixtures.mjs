#!/usr/bin/env node
/**
 * Regenerates the upgrade-matrix fixtures (plan v2.6, T.3) from the release tags.
 *
 *   node packages/tests/scripts/gen-upgrade-fixtures.mjs [--work <dir>] [--only <id,id>]
 *
 * For each published schema version it checks the release out into a git
 * worktree, installs and builds that release's SDK, and lets IT write a
 * realistic database (seed-upgrade-fixture.mjs). The fixtures are therefore
 * what those versions really produced, not hand-written SQL. Output:
 * packages/tests/fixtures/upgrade/<id>.db.gz (gzip: vec0 preallocates its
 * storage chunks, mostly zeros) plus manifest.json.
 *
 * `0.8.0-via-2.1.0` is the 0.8.0 fixture after v2.1.0 opened it (the state
 * of anyone who upgraded from 0.8.0 before 2.6).
 *
 * The one exception is `1.3.0-legacy`: the old .deb that wrote it was built
 * from a migration that was never committed, so no ref can produce it. It is
 * derived from the 1.3.0 fixture by swapping token_usage/scan_state for the
 * consumption_* tables, with the DDL as found in such an install (schema only).
 *
 * Slow (one pnpm install + build per release) and needs the network for the
 * first install; the results are committed, so CI never runs this.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../..');
const OUT = resolve(__dirname, '../fixtures/upgrade');

/** id → git ref. One per published schema version (the ids are schema versions, not app versions). */
export const RELEASES = [
  { id: '0.8.0', ref: 'v0.8.0', sdk: '@ai-knowledge/sdk' },
  { id: '0.9.0', ref: 'v0.9.0', sdk: '@ai-knowledge/sdk' },
  { id: '1.3.0', ref: 'v1.3.0', sdk: '@cognistore/sdk' },
  { id: '2.0.0', ref: 'v2.0.0', sdk: '@cognistore/sdk' },
  { id: '2.1.0', ref: 'v2.1.0', sdk: '@cognistore/sdk' },
  // 2.3.x: the last 2.3 release, schema 2.3.2.
  { id: '2.3.5', ref: 'v2.3.5', sdk: '@cognistore/sdk' },
  // v2.4.0 already shipped the 2.4.1 migration, so its schema equals 2.4.1's.
  { id: '2.4.0', ref: 'v2.4.0', sdk: '@cognistore/sdk' },
  { id: '2.4.1', ref: 'v2.4.1', sdk: '@cognistore/sdk' },
  // No tag yet when generated: the v2.5.4 release commit on main.
  { id: '2.5.4', ref: 'c273f87998604bd7d03c22c915e75210f6743196', sdk: '@cognistore/sdk' },
];

const LEGACY_DDL = [
  `CREATE TABLE consumption_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK(platform IN ('claude', 'copilot')),
  day DATE NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  project_path TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  cost_usd_cents INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'local',
  updated_at TEXT NOT NULL,
  UNIQUE(platform, day, model, project_path, source)
)`,
  `CREATE TABLE consumption_ingest_state (
  platform TEXT NOT NULL,
  source TEXT NOT NULL,
  file_path TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT NOT NULL,
  PRIMARY KEY (platform, source, file_path)
)`,
];

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const work = resolve(opt('--work') ?? join(tmpdir(), 'cognistore-upgrade-fixtures'));
const only = opt('--only')?.split(',');

const run = (cmd, argv, cwd, env = {}) =>
  execFileSync(cmd, argv, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

mkdirSync(work, { recursive: true });
mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : {};

function store(id, dbFile, from) {
  const db = new Database(dbFile);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.exec('VACUUM');
  // 0.8.0 predates schema_version (drizzle journal); the runner bootstraps it as 0.8.0.
  const hasVersions = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_version'").get();
  const schemaVersions = hasVersions ? db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version) : [];
  db.close();
  const gz = gzipSync(readFileSync(dbFile), { level: 9 });
  writeFileSync(join(OUT, `${id}.db.gz`), gz);
  manifest[id] = { from, schemaVersions, bytes: statSync(dbFile).size, gzBytes: gz.length };
  console.log(`[fixtures] ${id}: ${(gz.length / 1024).toFixed(1)} KB gz, schema ${schemaVersions.join(' ')}`);
}

for (const rel of RELEASES) {
  if (only && !only.includes(rel.id)) continue;
  const wt = join(work, `wt-${rel.id}`);
  if (!existsSync(wt)) run('git', ['worktree', 'add', '--detach', wt, rel.ref], REPO);
  run('pnpm', ['install', '--frozen-lockfile'], wt);
  run('pnpm', ['turbo', 'build', `--filter=${rel.sdk}...`], wt);

  const home = mkdtempSync(join(tmpdir(), `cognistore-fixture-home-${rel.id}-`));
  const dbFile = join(home, 'knowledge.db');
  try {
    run(process.execPath, [join(__dirname, 'seed-upgrade-fixture.mjs'), wt, dbFile], wt, { HOME: home });
    store(rel.id, dbFile, rel.ref);

    if (rel.id === '1.3.0' && (!only || only.includes('1.3.0-legacy'))) {
      const db = new Database(dbFile);
      db.exec('DROP TABLE IF EXISTS token_usage; DROP TABLE IF EXISTS scan_state;');
      for (const ddl of LEGACY_DDL) db.exec(ddl);
      const ins = db.prepare(`INSERT INTO consumption_samples (platform, day, model, project_path, input_tokens, output_tokens, sessions, messages, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (let d = 1; d <= 5; d++) ins.run('claude', `2026-04-0${d}`, 'claude-sonnet-4-5', '/home/user/Projects/fixture', 1000 * d, 100 * d, 1, 10 * d, '2026-04-06T00:00:00.000Z');
      db.prepare('INSERT INTO consumption_ingest_state (platform, source, file_path, byte_offset, last_run_at) VALUES (?, ?, ?, ?, ?)')
        .run('claude', 'local', '/home/user/.claude/projects/-home-user-Projects-fixture/s.jsonl', 4096, '2026-04-06T00:00:00.000Z');
      db.close();
      store('1.3.0-legacy', dbFile, `${rel.ref} + consumption_* DDL of the pre-2.0 .deb`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// A v0.8.0 database later opened by an older release: that runner stamped
// 0.8.0 without running it, so operations_log is still missing while
// schema_version already lists 0.8.0 … 2.1.0. Produced by v2.1.0's own client.
if (!only || only.includes('0.8.0-via-2.1.0')) {
  const wt = join(work, 'wt-2.1.0');
  if (!existsSync(wt)) throw new Error('0.8.0-via-2.1.0 needs the 2.1.0 worktree: generate 2.1.0 in the same run');
  const home = mkdtempSync(join(tmpdir(), 'cognistore-fixture-home-via-'));
  const dbFile = join(home, 'knowledge.db');
  try {
    writeFileSync(dbFile, gunzipSync(readFileSync(join(OUT, '0.8.0.db.gz'))));
    const open = `const { createDbClient } = await import(${JSON.stringify(pathToFileURL(join(wt, 'packages/core/dist/index.js')).href)});
      createDbClient(${JSON.stringify(dbFile)}).sqlite.close();`;
    run(process.execPath, ['--input-type=module', '-e', open], wt, { HOME: home });
    store('0.8.0-via-2.1.0', dbFile, 'v0.8.0 fixture opened by v2.1.0');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[fixtures] manifest: ${manifestPath}\n[fixtures] worktrees kept in ${work} (git worktree remove them when done)`);
