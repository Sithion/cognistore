import { test, expect } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDbClient,
  KnowledgeRepository,
  KnowledgeService,
  TokenUsageRepository,
  TokenUsageService,
  runMigrations,
  ClaudeCodeAdapter,
  invalidateDuplicateScan,
  type SQLiteDatabase,
} from '@cognistore/core';
import { copyFixture, ensureFixture, generateTokenJsonlDir, DEFAULT_FIXTURE } from './fixtures/generate-fixture.js';
import { budgetFor, hashEmbedder, measure, report } from './fixtures/perf-helpers.js';
import { startSdk, forbidMain } from '../r5-worker-helpers.js';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));

// Plan v2.6 item 0.4 — latency budgets on a 10k-entry / 200k-token-row base.
// Budgets come from baseline.json (max(4 × baseline, 50 ms)); every run prints
// `PERF <case> <ms>` so the numbers before/after each phase can be compared.

test.describe.configure({ mode: 'serial' });

let dir: string;
let sqlite: SQLiteDatabase;
let service: KnowledgeService;
let tokens: TokenUsageService;
let jsonlUsageLines = 0;

const DAY_MS = 86_400_000;
const REFERENCE = Date.UTC(2026, 9, 1);
const window = (days: number) => ({
  from: new Date(REFERENCE - days * DAY_MS).toISOString(),
  to: new Date(REFERENCE).toISOString(),
});

test.beforeAll(() => {
  test.setTimeout(300_000);
  const fixture = ensureFixture();
  dir = mkdtempSync(join(tmpdir(), 'cognistore-perf-large-'));
  const dbPath = copyFixture(fixture.path, dir);
  const client = createDbClient(dbPath);
  sqlite = client.sqlite;
  service = new KnowledgeService(new KnowledgeRepository(client.db, sqlite), hashEmbedder);
  const projectsDir = join(dir, 'claude-projects');
  jsonlUsageLines = generateTokenJsonlDir(projectsDir).usageLines;
  // Explicit adapter: never the developer's real ~/.claude.
  tokens = new TokenUsageService(new TokenUsageRepository(sqlite), [new ClaudeCodeAdapter({ projectsDir })]);
});

test.afterAll(() => {
  try { sqlite?.close(); } catch { /* already closed */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test.describe('@perf large database (0.4)', () => {
  test('tokens.migration243Backfill', () => {
    test.setTimeout(180_000);
    const migrationDir = mkdtempSync(join(tmpdir(), 'cognistore-perf-migration-'));
    const path = join(migrationDir, 'backfill.db');
    const db = new BetterSqlite3(path);
    try {
      db.exec(`CREATE TABLE schema_version(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO schema_version VALUES ('2.4.2', '2026-10-01T00:00:00Z');
        CREATE TABLE token_usage(id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT NOT NULL, project TEXT,
          session_id TEXT, message_id TEXT, occurred_at TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          cache_creation_tokens INTEGER NOT NULL DEFAULT 0, scanned_at TEXT NOT NULL);
        CREATE INDEX idx_token_usage_occurred ON token_usage(occurred_at);
        CREATE INDEX idx_token_usage_project ON token_usage(project);
        CREATE INDEX idx_token_usage_source_model ON token_usage(source, model);`);
      const insert = db.prepare(`INSERT INTO token_usage VALUES (?, 'claude-code', 'm1', ?, NULL, NULL, ?, 1, 2, 3, 4, ?)`);
      const bulk = db.transaction(() => {
        for (let i = 0; i < 200_000; i++) insert.run(`perf-${i}`, i % 2 ? 'project-a' : null,
          `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00.000Z`, '2026-10-29T00:00:00Z');
      });
      bulk();
      const start = performance.now();
      runMigrations(db, resolve(__dirname, '../../../core/src/db/migrations'));
      const ms = performance.now() - start;
      report('tokens.migration243Backfill', ms, { rows: 200_000 });
      expect((db.prepare('SELECT SUM(messages) AS n FROM token_usage_daily').get() as { n: number }).n).toBe(200_000);
    } finally { db.close(); rmSync(migrationDir, { recursive: true, force: true }); }
  });

  test('fixture has the expected shape', () => {
    const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
    expect(count('SELECT count(*) AS n FROM knowledge_entries')).toBe(DEFAULT_FIXTURE.entries);
    expect(count('SELECT count(*) AS n FROM knowledge_fts')).toBe(DEFAULT_FIXTURE.entries);
    expect(count('SELECT count(*) AS n FROM token_usage')).toBe(DEFAULT_FIXTURE.tokenRows);
    expect(count('SELECT count(*) AS n FROM operations_log')).toBe(DEFAULT_FIXTURE.opsRows);
  });

  test('hybrid search', async () => {
    let hits = 0;
    const ms = await measure(async () => {
      hits = (await service.search('sqlite transaction lock latency', { limit: 10 })).length;
    });
    report('search.hybrid', ms);
    expect(hits).toBeGreaterThan(0);
    expect(ms).toBeLessThan(budgetFor('search.hybrid'));
  });

  test('listRecent, first page and deep offset', async () => {
    let first = 0;
    let deep = 0;
    const ms0 = await measure(async () => { first = (await service.listRecent(20, undefined, 0)).length; });
    const ms5000 = await measure(async () => { deep = (await service.listRecent(20, undefined, 5000)).length; });
    report('listRecent.offset0', ms0);
    report('listRecent.offset5000', ms5000);
    expect(first).toBe(20);
    expect(deep).toBe(20);
    expect(ms0).toBeLessThan(budgetFor('listRecent.offset0'));
    expect(ms5000).toBeLessThan(budgetFor('listRecent.offset5000'));
  });

  test('knowledge stats', async () => {
    let total = 0;
    const ms = await measure(async () => { total = (await service.getStats()).total; });
    report('stats.knowledge', ms);
    expect(total).toBe(DEFAULT_FIXTURE.entries);
    expect(ms).toBeLessThan(budgetFor('stats.knowledge'));
  });

  test('tokens.aggregates, 30 and 180 days', async () => {
    let rows30 = 0;
    let rows180 = 0;
    const ms30 = await measure(() => { rows30 = tokens.getAggregates(window(30)).byDay.length; });
    const ms180 = await measure(() => { rows180 = tokens.getAggregates(window(180)).byDay.length; });
    report('tokens.aggregates30d', ms30);
    report('tokens.aggregates180d', ms180);
    expect(rows30).toBeGreaterThan(25);
    expect(rows180).toBeGreaterThan(rows30);
    expect(ms30).toBeLessThan(budgetFor('tokens.aggregates30d'));
    expect(ms180).toBeLessThan(budgetFor('tokens.aggregates180d'));
  });

  test('tokens.aggregatesProjectEdge by project on a partial edge', async () => {
    const from = new Date(REFERENCE - 30 * DAY_MS + 13 * 60 * 60 * 1000).toISOString();
    let rows = 0;
    const ms = await measure(() => { rows = tokens.getAggregates({ ...window(30), from }).byProject.length; });
    report('tokens.aggregatesProjectEdge', ms);
    expect(rows).toBeGreaterThan(0);
  });

  test('duplicate groups: SDK worker headline and separately labeled direct core', async () => {
    test.setTimeout(Math.max(2 * budgetFor('duplicates.groups') + 60_000, 180_000));
    const started = await startSdk(sqlite.name);
    try {
      invalidateDuplicateScan(sqlite);
      const restore = forbidMain(['findDuplicateGroups']);
      let groups: Awaited<ReturnType<typeof started.sdk.findDuplicateGroups>>;
      const start = performance.now();
      try { groups = await started.sdk.findDuplicateGroups(); }
      finally { restore(); }
      const ms = performance.now() - start;
      report('duplicates.groups', ms, { groups: groups.length });
      expect(groups.length).toBeGreaterThan(50);
      expect(groups.every((g) => g.members.length >= 2)).toBe(true);
      expect(ms).toBeLessThan(budgetFor('duplicates.groups'));
      invalidateDuplicateScan(sqlite);
      const coreStart = performance.now();
      const direct = await service.findDuplicateGroups();
      report('duplicates.groups.core', performance.now() - coreStart, { groups: direct.length });
      const canonical = (xs: typeof direct) => xs.map((g) => g.members.map((m) => m.id).sort().join(',')).sort();
      expect(canonical(direct)).toEqual(canonical(groups));
    } finally { await started.close(); }
  });

  test('token scan, full then incremental', async () => {
    test.setTimeout(120_000);
    let start = performance.now();
    const full = await tokens.scan();
    const fullMs = performance.now() - start;
    start = performance.now();
    const again = await tokens.scan();
    const incrementalMs = performance.now() - start;
    report('tokens.scanFull', fullMs, { inserted: full.inserted });
    report('tokens.scanIncremental', incrementalMs, { inserted: again.inserted });
    expect(full.inserted).toBe(jsonlUsageLines);
    expect(again.inserted).toBe(0);
    expect(fullMs).toBeLessThan(budgetFor('tokens.scanFull'));
    expect(incrementalMs).toBeLessThan(budgetFor('tokens.scanIncremental'));
  });
});
