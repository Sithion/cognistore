import { test, expect } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { runMigrations } from '@cognistore/core';
import { KnowledgeSDK } from '@cognistore/sdk';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';
import { startMockOllama } from '../sidecar-helpers.js';

const require = createRequire(import.meta.url);
const sqliteVec = require('sqlite-vec');

/**
 * Upgrade matrix (plan v2.6, T.3). One fixture per published schema, written by
 * that release's own SDK (scripts/gen-upgrade-fixtures.mjs — from the release
 * tags, never by hand). Each is opened with THIS checkout's code, the way the
 * sidecar and every MCP server open it, and must come out whole:
 *   - no row lost in any table that existed before, entries byte-identical;
 *   - FTS covers every entry and matches; one embedding per entry at the
 *     current dimensions (0.x stored 384-d vectors: the SDK re-embeds them);
 *   - search finds a seeded entry;
 *   - migrations are idempotent: a second run changes nothing, and the
 *     embedded set (bundled MCP) yields the same schema as the .sql files.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../fixtures/upgrade');
const MIGRATIONS_DIR = resolve(__dirname, '../../../core/src/db/migrations');
const NO_DIR = join(tmpdir(), 'cognistore-no-migrations-dir'); // missing → embedded migrations

const manifest: Record<string, { from: string; schemaVersions: string[] }> =
  JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf-8'));

/** Tables the SDK owns as derived indexes (vec0/FTS5 shadow tables), not data. */
const DERIVED = /^(sqlite_|knowledge_embeddings|plans_embeddings|knowledge_fts)/;

function open(path: string): BetterSqlite3.Database {
  const db = new BetterSqlite3(path);
  sqliteVec.load(db);
  return db;
}

const tables = (db: BetterSqlite3.Database): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map((r) => r.name).filter((n) => !DERIVED.test(n));

const count = (db: BetterSqlite3.Database, table: string): number =>
  (db.prepare(`SELECT count(*) AS c FROM "${table}"`).get() as { c: number }).c;

/** Everything a migration could touch: applied versions, the DDL, and row counts. */
function schemaState(db: BetterSqlite3.Database) {
  return {
    versions: (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: string }[]).map((r) => r.version),
    ddl: db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all(),
    counts: Object.fromEntries(tables(db).map((t) => [t, count(db, t)])),
  };
}

let work: string;
let mock: Awaited<ReturnType<typeof startMockOllama>>;

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'cognistore-upgrade-matrix-'));
  mock = await startMockOllama('nomic-embed-text');
});

test.afterAll(async () => {
  await new Promise<void>((r) => (mock ? mock.server.close(() => r()) : r()));
  if (work) rmSync(work, { recursive: true, force: true });
});

function unpack(id: string, name: string): string {
  const path = join(work, `${id}-${name}.db`);
  writeFileSync(path, gunzipSync(readFileSync(join(FIXTURES, `${id}.db.gz`))));
  return path;
}

test('the matrix covers every published schema version', () => {
  // 0.8.0 (pre-schema_version, also as left behind by an older runner), every
  // 2.x line, and the legacy 1.3.0 .deb layout.
  expect(Object.keys(manifest).sort()).toEqual(
    ['0.8.0', '0.8.0-via-2.1.0', '0.9.0', '1.3.0', '1.3.0-legacy', '2.0.0', '2.1.0', '2.3.5', '2.4.0', '2.4.1', '2.5.4'].sort(),
  );
  const published = ['0.8.0', '0.9.0', '1.3.0', '2.0.0', '2.1.0', '2.3.0', '2.3.2', '2.4.0', '2.4.1'];
  const unreleased = ['2.4.2', '2.4.3', '2.4.5'];
  const shipped = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace('.sql', '')).sort();
  expect([...manifest['2.5.4'].schemaVersions].sort()).toEqual([...published].sort());
  expect(shipped).toEqual([...published, ...unreleased].sort());
});

for (const id of Object.keys(manifest)) {
  test.describe(`upgrade from ${id}`, () => {
    test('opening with the current SDK loses no row and keeps search whole', async () => {
      const path = unpack(id, 'sdk');

      const before = open(path);
      const tablesBefore = tables(before);
      const countsBefore = Object.fromEntries(tablesBefore.map((t) => [t, count(before, t)]));
      const entriesBefore = before
        .prepare('SELECT id, content, type, scope, tags, created_at FROM knowledge_entries ORDER BY id').all();
      before.close();
      expect(entriesBefore.length).toBeGreaterThan(5);
      // v0.8.0 never had operations_log, and older runners stamped 0.8.0 without creating it.
      if (id.startsWith('0.8.0')) expect(tablesBefore).not.toContain('operations_log');

      const sdk = new KnowledgeSDK({
        database: { path },
        ollama: { host: `http://127.0.0.1:${mock.port}`, model: 'nomic-embed-text', dimensions: DEFAULT_EMBEDDING_DIMENSIONS },
      });
      await sdk.initialize();
      try {
        await sdk.waitForFtsRepair();
        const hits = await sdk.getKnowledge('quote the term or use the vector path');
        const gotcha = (entriesBefore as { id: string; content: string }[]).find((e) => e.content.includes('c++'))!;
        expect(hits.map((h) => h.entry.id)).toContain(gotcha.id);
      } finally {
        await sdk.close();
      }

      const after = open(path);
      try {
        const removed = ['consumption_samples', 'consumption_ingest_state'];
        if (id === '1.3.0-legacy') {
          for (const t of removed) expect(tablesBefore).toContain(t);
        }
        for (const t of removed) expect(tables(after)).not.toContain(t);
        for (const t of tablesBefore) {
          if (removed.includes(t)) continue;
          expect(tables(after), `table ${t} survived`).toContain(t);
          expect(count(after, t), `rows of ${t}`).toBeGreaterThanOrEqual(countsBefore[t]);
        }
        // Entries are byte-identical where they existed (new columns are allowed).
        expect(after.prepare('SELECT id, content, type, scope, tags, created_at FROM knowledge_entries ORDER BY id').all())
          .toEqual(entriesBefore);

        const n = count(after, 'knowledge_entries');
        expect(after.pragma('table_info(knowledge_entries)') as any).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'content_hash' })]));
        expect(after.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_knowledge_content_hash'").get()).toBeTruthy();
        expect(after.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='knowledge_content_hash_invalidate'").get()).toBeTruthy();
        expect(after.prepare('SELECT count(*) AS c FROM knowledge_entries WHERE content_hash IS NOT NULL').get()).toEqual({ c: 0 });
        const missing = (after.prepare("SELECT count(*) AS n FROM knowledge_entries WHERE type != 'system' AND id NOT IN (SELECT id FROM knowledge_fts)").get() as { n: number }).n;
        expect(missing).toBe(0);
        // A content word: 0.8.0 had no title column and silently dropped titles.
        expect((after.prepare("SELECT count(*) AS c FROM knowledge_fts WHERE knowledge_fts MATCH 'vector'").get() as { c: number }).c).toBe(1);

        expect(count(after, 'knowledge_embeddings')).toBe(n);
        const vec = after.prepare('SELECT embedding FROM knowledge_embeddings LIMIT 1').get() as { embedding: Buffer };
        expect(vec.embedding.byteLength / 4).toBe(DEFAULT_EMBEDDING_DIMENSIONS);

        // Legacy installs gain current tables; only the two approved obsolete tables are removed.
        expect(tables(after)).toEqual(expect.arrayContaining(['operations_log', 'token_usage', 'scan_state', 'plans', 'plan_tasks']));
        const shipped = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4)).sort();
        expect(schemaState(after).versions).toEqual(shipped);
        expect(after.pragma('integrity_check', { simple: true })).toBe('ok');
      } finally {
        after.close();
      }
    });

    test('migrations are idempotent, from disk and embedded alike', () => {
      const disk = open(unpack(id, 'disk'));
      const embedded = open(unpack(id, 'embedded'));
      try {
        runMigrations(disk, MIGRATIONS_DIR);
        runMigrations(embedded, NO_DIR);
        const once = schemaState(disk);
        const shipped = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4)).sort();
        expect(once.versions).toEqual(shipped);
        // The bundled MCP server and the sidecar must leave the same database.
        expect(schemaState(embedded)).toEqual(once);

        runMigrations(disk, MIGRATIONS_DIR);
        runMigrations(disk, NO_DIR);
        runMigrations(embedded, NO_DIR);
        expect(schemaState(disk)).toEqual(once);
        expect(schemaState(embedded)).toEqual(once);
      } finally {
        disk.close();
        embedded.close();
      }
    });
  });
}
