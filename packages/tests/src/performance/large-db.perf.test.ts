import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDbClient,
  KnowledgeRepository,
  KnowledgeService,
  TokenUsageRepository,
  TokenUsageService,
  ClaudeCodeAdapter,
  type SQLiteDatabase,
} from '@cognistore/core';
import { copyFixture, ensureFixture, generateTokenJsonlDir, DEFAULT_FIXTURE } from './fixtures/generate-fixture.js';
import { budgetFor, hashEmbedder, measure, report } from './fixtures/perf-helpers.js';

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

  test('token aggregates, 30 and 180 days', async () => {
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

  test('duplicate groups (single run, full scan — 1C.3 made it cooperative; see duplicates-eventloop)', async () => {
    test.setTimeout(Math.max(budgetFor('duplicates.groups') + 60_000, 120_000));
    const start = performance.now();
    const groups = await service.findDuplicateGroups();
    const ms = performance.now() - start;
    report('duplicates.groups', ms, { groups: groups.length });
    // The fixture plants ~140 clusters; the call caps the result list.
    expect(groups.length).toBeGreaterThan(50);
    expect(groups.every((g) => g.members.length >= 2)).toBe(true);
    expect(ms).toBeLessThan(budgetFor('duplicates.groups'));
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
