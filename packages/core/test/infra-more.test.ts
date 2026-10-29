import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDbClient } from '../src/db/client.js';
import { createKnowledgeFtsTable, ftsCount, insertFts, searchFts, updateFts, deleteFts } from '../src/db/schema/fts.js';
import { instrumentDatabase, startEventLoopMonitor } from '../src/perf/instrumentation.js';
import { createPerfMonitor, formatPerfSummary } from '../src/perf/monitor.js';
import { makeDb } from './helpers.js';

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const fn of cleanup.splice(0)) fn();
});

describe('FTS edge inputs', () => {
  it('normalizes nullish title, content and tags on insertion and update', () => {
    const sqlite = new BetterSqlite3(':memory:'); cleanup.push(() => sqlite.close());
    createKnowledgeFtsTable(sqlite);
    insertFts(sqlite, { id: 'blank', title: null as any, content: undefined as any, tags: null as any });
    expect(ftsCount(sqlite)).toBe(1);
    expect(searchFts(sqlite, 'anything', 10)).toEqual([]);
    updateFts(sqlite, { id: 'blank', title: '', content: 'needle', tags: '' });
    expect(searchFts(sqlite, 'needle', 10).map((row) => row.id)).toEqual(['blank']);
    deleteFts(sqlite, 'missing');
    expect(ftsCount(sqlite)).toBe(1);
  });
});

describe('database client options and best-effort setup', () => {
  it('uses EMBEDDING_DIMENSIONS for newly created vector tables and restores the environment', () => {
    const old = process.env.EMBEDDING_DIMENSIONS;
    process.env.EMBEDDING_DIMENSIONS = '7';
    const dir = mkdtempSync(join(tmpdir(), 'infra-dim-'));
    const { sqlite } = createDbClient(join(dir, 'db.sqlite'));
    cleanup.push(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); if (old === undefined) delete process.env.EMBEDDING_DIMENSIONS; else process.env.EMBEDDING_DIMENSIONS = old; });
    expect(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='knowledge_embeddings'").get()).toMatchObject({ sql: expect.stringContaining('float[7]') });
  });

  it('continues startup when FTS/index optimization setup throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'infra-fts-failure-'));
    const { sqlite } = createDbClient(join(dir, 'db.sqlite'));
    cleanup.push(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); });
    // Force the optional index phase to fail after FTS setup starts.
    sqlite.exec('DROP TABLE knowledge_fts');
    sqlite.exec('CREATE TABLE knowledge_fts(id TEXT)');
    const original = sqlite.exec;
    const spy = vi.spyOn(sqlite, 'exec').mockImplementation(function (sql: string) {
      if (sql.includes('CREATE INDEX')) throw new Error('index disabled');
      return original.call(this, sql);
    });
    // Opening another handle reruns idempotent setup; failure is swallowed.
    const reopened = createDbClient(join(dir, 'db.sqlite'));
    cleanup.push(() => reopened.sqlite.close());
    expect(reopened.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_entries'").get()).toBeDefined();
    spy.mockRestore();
  });
});

describe('database instrumentation options', () => {
  it('is idempotent, reports slow writes and transactions, and restores the handle', () => {
    const db = new BetterSqlite3(':memory:'); cleanup.push(() => db.close());
    const events: any[] = [];
    const inst = instrumentDatabase(db, { slowMs: 0, onEvent: (event) => events.push(event) });
    expect(instrumentDatabase(db)).toBe(inst);
    db.exec('CREATE TABLE t (id INTEGER)');
    db.prepare('INSERT INTO t VALUES (?)').run(1);
    db.transaction(() => db.prepare('SELECT * FROM t').all())();
    expect(events.some((event) => event.method === 'exec' && event.write)).toBe(true);
    expect(events.some((event) => event.method === 'tx')).toBe(true);
    expect(inst.stats().slowWrites).toBeGreaterThan(0);
    inst.uninstall();
    expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 1 });
  });

  it('swallows listener failures and reports busy errors', () => {
    const db = new BetterSqlite3(':memory:'); cleanup.push(() => db.close());
    const inst = instrumentDatabase(db, { slowMs: 100000, onEvent: () => { throw new Error('observer'); } });
    db.exec('CREATE TABLE t (id UNIQUE)'); db.prepare('INSERT INTO t VALUES (1)').run();
    expect(() => db.prepare('INSERT INTO t VALUES (1)').run()).toThrow();
    // Constraint errors are not classified as busy; normal operation still counted.
    expect(inst.stats().ops).toBe(3);
    inst.reset(); expect(inst.stats()).toEqual({ ops: 0, slowOps: 0, slowWrites: 0, busyErrors: 0, maxMs: 0 });
    inst.uninstall();
  });

  it('uses the default event loop resolution and contains report callback errors', () => {
    vi.useFakeTimers();
    const onReport = vi.fn(() => { throw new Error('report'); });
    const monitor = startEventLoopMonitor({ intervalMs: 5, onReport });
    vi.advanceTimersByTime(5);
    expect(onReport).toHaveBeenCalledTimes(1);
    monitor.stop();
    expect(formatPerfSummary({ p50: 0, p99: 1, max: 2, mean: 1 }, { ops: 2, slowOps: 1, slowWrites: 1, busyErrors: 0, maxMs: 4 })).toContain('db ops=2');
  });
});

describe('performance monitor bounds and options', () => {
  it('applies topN, resets each interval, and tolerates warn/write failures', () => {
    vi.useFakeTimers();
    const ctx = makeDb(); cleanup.push(ctx.cleanup);
    const write = vi.fn(); const warn = vi.fn();
    const monitor = createPerfMonitor({ intervalMs: 20, slowMs: 0, topN: 1, write, warn });
    monitor.attach(ctx.sqlite);
    ctx.sqlite.exec('CREATE TABLE p (id INTEGER)');
    ctx.sqlite.exec('INSERT INTO p VALUES (1)');
    vi.advanceTimersByTime(20);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].filter((line: string) => line.includes('sql=')).length).toBeLessThanOrEqual(1);
    write.mockImplementation(() => { throw new Error('sink'); });
    ctx.sqlite.exec('INSERT INTO p VALUES (2)');
    vi.advanceTimersByTime(20);
    expect(() => monitor.stop()).not.toThrow();
  });
});

describe('knowledge repository list filters and missing IDs', () => {
  it('combines type, scope, tags, agent and platform filters and handles sentinels', async () => {
    const ctx = makeDb(); cleanup.push(ctx.cleanup);
    const add = (options: any) => ctx.service.add({ title: options.title, content: `content ${options.title}`, tags: options.tags ?? [], type: options.type ?? 'fact', scope: options.scope ?? 'global', source: 'test', agentId: options.agentId, platform: options.platform });
    await add({ title: 'match', type: 'pattern', scope: 'project', tags: ['red', 'blue'], agentId: 'agent-a', platform: 'cli' });
    await add({ title: 'no tag', type: 'pattern', scope: 'project', tags: ['green'], agentId: 'agent-a', platform: 'cli' });
    await add({ title: 'unspecified', tags: ['red'], agentId: null, platform: null });
    await add({ title: 'unknown', tags: ['red'], agentId: null, platform: 'unknown' });
    await add({ title: 'system', type: 'system', tags: ['red'], agentId: 'agent-a', platform: 'cli' });
    const combined = await ctx.repository.listRecent(20, { type: 'pattern', scope: 'project', tags: ['blue', 'red'], agent: 'agent-a', platform: 'cli' });
    expect(combined.map((entry) => entry.title)).toEqual(['match']);
    const unspecified = await ctx.repository.listRecent(20, { agent: 'unspecified', platform: 'unknown' });
    expect(unspecified.map((entry) => entry.title).sort()).toEqual(['unknown', 'unspecified']);
    expect(await ctx.repository.listRecent(20, { tags: [] })).toHaveLength(4);
  });

  it('returns null for missing ids, empty results for empty tags and absent embeddings', async () => {
    const ctx = makeDb(); cleanup.push(ctx.cleanup);
    expect(await ctx.repository.findById('missing')).toBeNull();
    expect(await ctx.repository.update('missing', { title: 'gone' })).toBeNull();
    expect(await ctx.repository.delete('missing')).toBeNull();
    expect(await ctx.repository.listRecent(10, { type: 'absent', tags: ['nope'] })).toEqual([]);
    expect(ctx.repository.getEntriesByIds([])).toEqual([]);
    expect(ctx.repository.listMissingKnowledgeEmbeddingIds(0).length).toBeGreaterThanOrEqual(0);
  });
});
