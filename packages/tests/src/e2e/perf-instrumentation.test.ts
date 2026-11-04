import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import {
  createDbClient,
  instrumentDatabase,
  startEventLoopMonitor,
  type SlowOpEvent,
  type SQLiteDatabase,
} from '@cognistore/core';

// Plan v2.6 item 0.2 — slow-op / SQLITE_BUSY / event-loop instrumentation.

let dir: string;
let sqlite: SQLiteDatabase;

/** Busy-wait inside SQLite so a statement is deterministically slow. */
function addSleepFunction(db: SQLiteDatabase) {
  db.function('sleep_ms', (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end) { /* spin */ }
    return ms;
  });
}

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cognistore-perf-instr-'));
  sqlite = createDbClient(join(dir, 'k.db')).sqlite;
  addSleepFunction(sqlite);
});

test.afterEach(() => {
  try { sqlite.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

test.describe('@e2e perf instrumentation (0.2)', () => {
  test('fast ops are counted but emit no event', () => {
    const events: SlowOpEvent[] = [];
    const instr = instrumentDatabase(sqlite, { slowMs: 100, onEvent: (e) => events.push(e) });
    sqlite.prepare('SELECT 1').get();
    sqlite.prepare("SELECT count(*) FROM knowledge_entries").all();
    expect(instr.stats().ops).toBe(2);
    expect(instr.stats().slowOps).toBe(0);
    expect(events).toHaveLength(0);
    instr.uninstall();
  });

  test('slow read emits a slow event with SQL text and no bound values', () => {
    const events: SlowOpEvent[] = [];
    const instr = instrumentDatabase(sqlite, { slowMs: 20, onEvent: (e) => events.push(e) });
    sqlite.prepare("SELECT sleep_ms(40) AS s, ? AS secret").get('top-secret-value');
    const s = instr.stats();
    expect(s.slowOps).toBe(1);
    expect(s.slowWrites).toBe(0);
    expect(s.maxMs).toBeGreaterThanOrEqual(40);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'slow', method: 'get', write: false });
    expect(events[0].sql).toContain('sleep_ms(40)');
    expect(JSON.stringify(events[0])).not.toContain('top-secret-value');
    instr.uninstall();
  });

  test('slow write is classified as a write', () => {
    const events: SlowOpEvent[] = [];
    const instr = instrumentDatabase(sqlite, { slowMs: 20, onEvent: (e) => events.push(e) });
    sqlite.prepare("INSERT INTO operations_log(operation, created_at) VALUES ('read', datetime('now', '+' || sleep_ms(40) || ' seconds'))").run();
    expect(instr.stats().slowWrites).toBe(1);
    expect(events[0]).toMatchObject({ kind: 'slow', method: 'run', write: true });
    instr.uninstall();
  });

  test('SQLITE_BUSY is counted, reported and rethrown unchanged', () => {
    const events: SlowOpEvent[] = [];
    const instr = instrumentDatabase(sqlite, { slowMs: 1000, onEvent: (e) => events.push(e) });
    const other = new BetterSqlite3(join(dir, 'k.db'));
    try {
      other.pragma('busy_timeout = 0');
      other.exec('BEGIN IMMEDIATE');
      sqlite.pragma('busy_timeout = 0');
      let caught: any;
      try {
        sqlite.prepare("INSERT INTO operations_log(operation, created_at) VALUES ('write', datetime('now'))").run();
      } catch (e) { caught = e; }
      expect(caught?.code).toBe('SQLITE_BUSY');
      expect(instr.stats().busyErrors).toBe(1);
      expect(events.map((e) => e.kind)).toEqual(['busy']);
      expect(events[0].write).toBe(true);
    } finally {
      try { other.exec('ROLLBACK'); } catch { /* none */ }
      other.close();
      instr.uninstall();
    }
  });

  test('exec is timed as a write; reset clears counters; installing twice reuses the instance', () => {
    const instr = instrumentDatabase(sqlite, { slowMs: 20 });
    expect(instrumentDatabase(sqlite)).toBe(instr);
    sqlite.exec("CREATE TEMP TABLE t AS SELECT sleep_ms(30) AS x");
    expect(instr.stats()).toMatchObject({ slowOps: 1, slowWrites: 1 });
    instr.reset();
    expect(instr.stats()).toEqual({ ops: 0, slowOps: 0, slowWrites: 0, busyErrors: 0, maxMs: 0 });
    instr.uninstall();
  });

  test('uninstall restores the original prepare/exec', () => {
    const before = sqlite.prepare;
    const instr = instrumentDatabase(sqlite, { slowMs: 1 });
    expect(sqlite.prepare).not.toBe(before);
    instr.uninstall();
    expect(sqlite.prepare).toBe(before);
    sqlite.prepare('SELECT 1').get();
    expect(instr.stats().ops).toBe(0);
    // A fresh install after uninstall works.
    const again = instrumentDatabase(sqlite, { slowMs: 1000 });
    sqlite.prepare('SELECT 1').get();
    expect(again.stats().ops).toBe(1);
    again.uninstall();
  });

  test('a whole transaction is timed as one write op, including its variants', () => {
    const events: SlowOpEvent[] = [];
    const instr = instrumentDatabase(sqlite, { slowMs: 20, onEvent: (e) => events.push(e) });
    const insert = sqlite.prepare("INSERT INTO operations_log(operation, created_at) VALUES ('write', datetime('now'))");
    const tx = sqlite.transaction(function bulkInsert(n: number) {
      for (let i = 0; i < n; i++) insert.run();
      sqlite.prepare('SELECT sleep_ms(30)').get();
      return n;
    });
    expect(tx(5)).toBe(5);
    expect(tx.immediate(2)).toBe(2);
    const txEvents = events.filter((e) => e.method === 'tx');
    expect(txEvents).toHaveLength(2);
    expect(txEvents[0]).toMatchObject({ kind: 'slow', write: true, sql: 'transaction bulkInsert' });
    instr.uninstall();
    expect(typeof sqlite.transaction(() => 1)).toBe('function');
  });

  test('INSERT … RETURNING is classified as a write', () => {
    const events: SlowOpEvent[] = [];
    const instr = instrumentDatabase(sqlite, { slowMs: 20, onEvent: (e) => events.push(e) });
    sqlite.prepare("INSERT INTO operations_log(operation, created_at) VALUES ('write', datetime('now', '+' || sleep_ms(30) || ' seconds')) RETURNING id").get();
    expect(events[0]).toMatchObject({ method: 'get', write: true });
    instr.uninstall();
  });

  test('a throwing listener never breaks the query', () => {
    const instr = instrumentDatabase(sqlite, { slowMs: 1, onEvent: () => { throw new Error('boom'); } });
    expect(sqlite.prepare('SELECT sleep_ms(5) AS s').get()).toEqual({ s: 5 });
    instr.uninstall();
  });

  test('event-loop monitor reports blocking delay', async () => {
    const reports: { p99: number; max: number }[] = [];
    const mon = startEventLoopMonitor({ intervalMs: 200, resolutionMs: 10, onReport: (r) => reports.push(r) });
    await new Promise((r) => setTimeout(r, 50));
    const end = performance.now() + 120; // block the loop for ~120 ms
    while (performance.now() < end) { /* spin */ }
    await new Promise((r) => setTimeout(r, 400));
    mon.stop();
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...reports.map((r) => r.max))).toBeGreaterThanOrEqual(80);
  });
});
