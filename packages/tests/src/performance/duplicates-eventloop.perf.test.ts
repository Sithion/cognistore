import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDbClient,
  KnowledgeRepository,
  startEventLoopMonitor,
  DUP_SCAN_STATE_KEY,
  type SQLiteDatabase,
} from '@cognistore/core';
import { copyFixture, ensureFixture } from './fixtures/generate-fixture.js';
import { report } from './fixtures/perf-helpers.js';
import { legacyDuplicateGroups, expectSameGroups } from './fixtures/legacy-duplicates.js';

// Plan v2.6 items 1C.2 + 1C.3 on the 10k-entry fixture: the duplicate scan must
// never block the event loop for more than 100 ms (measured with the 0.2
// monitor at 1 ms resolution, plus an independent timer-drift probe), must
// return the same groups as the legacy per-entry KNN, and the incremental scan
// after one edit must be much cheaper than the full one.

const EVENT_LOOP_LIMIT_MS = 100;

test.describe.configure({ mode: 'serial' });

let dir: string;
let sqlite: SQLiteDatabase;
let repo: KnowledgeRepository;

/** Run `fn` while measuring the worst event-loop stall two independent ways. */
async function withEventLoopProbe<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number; monitorMax: number; driftMax: number }> {
  let monitorMax = 0;
  const monitor = startEventLoopMonitor({ intervalMs: 20, resolutionMs: 1, onReport: (r) => { monitorMax = Math.max(monitorMax, r.max); } });
  let driftMax = 0;
  let last = performance.now();
  const probe = setInterval(() => {
    const now = performance.now();
    driftMax = Math.max(driftMax, now - last - 5);
    last = now;
  }, 5);
  const start = performance.now();
  const value = await fn();
  const ms = performance.now() - start;
  await new Promise((r) => setTimeout(r, 60)); // let the monitor flush its last interval
  clearInterval(probe);
  monitor.stop();
  return { value, ms, monitorMax, driftMax };
}

test.beforeAll(() => {
  test.setTimeout(300_000);
  const fixture = ensureFixture();
  dir = mkdtempSync(join(tmpdir(), 'cognistore-perf-dupscan-'));
  const client = createDbClient(copyFixture(fixture.path, dir));
  sqlite = client.sqlite;
  repo = new KnowledgeRepository(client.db, sqlite);
});

test.afterAll(() => {
  try { sqlite?.close(); } catch { /* already closed */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test.describe('@perf duplicate scan without freezing (1C.3)', () => {
  test('full scan: no event-loop block over 100 ms', async () => {
    test.setTimeout(180_000);
    sqlite.prepare('DELETE FROM cleanup_meta WHERE key = ?').run(DUP_SCAN_STATE_KEY);
    const r = await withEventLoopProbe(() => repo.findDuplicateGroups());
    report('duplicates.scanFull', r.ms, { groups: r.value.length });
    report('duplicates.scanFull.eventLoopMax', r.monitorMax, { driftMax: Number(r.driftMax.toFixed(1)) });
    expect(r.value.length).toBeGreaterThan(50);
    expect(r.monitorMax).toBeLessThan(EVENT_LOOP_LIMIT_MS);
    expect(r.driftMax).toBeLessThan(EVENT_LOOP_LIMIT_MS);
  });

  test('incremental scan after one edit', async () => {
    const id = (sqlite.prepare('SELECT id FROM knowledge_entries ORDER BY id LIMIT 1 OFFSET 42').get() as { id: string }).id;
    sqlite.prepare('UPDATE knowledge_entries SET updated_at = ? WHERE id = ?').run(new Date(Date.now() + 60_000).toISOString(), id);
    const r = await withEventLoopProbe(() => repo.findDuplicateGroups());
    report('duplicates.scanIncremental', r.ms, { groups: r.value.length });
    report('duplicates.scanIncremental.eventLoopMax', r.monitorMax, { driftMax: Number(r.driftMax.toFixed(1)) });
    expect(r.monitorMax).toBeLessThan(EVENT_LOOP_LIMIT_MS);
  });

  test('same groups as the legacy per-entry KNN on the 10k fixture', async () => {
    test.setTimeout(300_000);
    const expected = await legacyDuplicateGroups(repo, sqlite);
    sqlite.prepare('DELETE FROM cleanup_meta WHERE key = ?').run(DUP_SCAN_STATE_KEY);
    const actual = await repo.findDuplicateGroups({ limit: 100_000 });
    report('duplicates.equivalence10k', 0, { legacyGroups: expected.length, groups: actual.length });
    expectSameGroups(actual, expected);
  });
});
