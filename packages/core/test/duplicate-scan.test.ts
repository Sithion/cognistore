import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from './helpers.js';
import { DUP_SCAN_STATE_KEY, dupScanStateKey, invalidateDuplicateScan, MAX_SCAN_ENTRIES, scanDuplicatePairs } from '../src/services/duplicate-scan.js';

describe('duplicate scan', () => {
  let ctx: ReturnType<typeof makeDb> | undefined;
  afterEach(() => { ctx?.cleanup(); ctx = undefined; vi.restoreAllMocks(); });

  async function add(title: string, content: string, type: any = 'pattern') {
    return ctx!.service.add({ title, content, tags: [], type, scope: 'global', source: 'test' });
  }

  it('returns empty full result and excludes system rows', async () => {
    ctx = makeDb();
    await add('System', 'internal content', 'system');
    const result = await scanDuplicatePairs(ctx.sqlite, 0.8);
    expect(result).toMatchObject({ pairs: [], mode: 'full', compared: 0, truncated: false });
    expect(result.meta.size).toBe(0);
  });

  it('runs full then incremental scans and persists threshold state', async () => {
    ctx = makeDb();
    await add('A', 'shared alpha details', 'pattern'); await add('B', 'shared alpha details', 'decision');
    const first = await scanDuplicatePairs(ctx.sqlite, 0.8);
    expect(first.mode).toBe('full');
    expect(first.pairs).toHaveLength(1);
    expect(ctx.sqlite.prepare('SELECT value FROM cleanup_meta WHERE key = ?').get(dupScanStateKey(0.8))).toBeDefined();
    const second = await scanDuplicatePairs(ctx.sqlite, 0.8);
    expect(second.mode).toBe('incremental');
    expect(second.pairs).toHaveLength(1);
  });

  it('invalidates all duplicate scan cache keys', async () => {
    ctx = makeDb(); await add('A', 'shared text'); await add('B', 'shared text');
    await scanDuplicatePairs(ctx.sqlite, 0.5);
    expect(ctx.sqlite.prepare('SELECT key FROM cleanup_meta WHERE key LIKE ?').all(`${DUP_SCAN_STATE_KEY}%`)).not.toEqual([]);
    invalidateDuplicateScan(ctx.sqlite);
    expect(ctx.sqlite.prepare('SELECT key FROM cleanup_meta WHERE key LIKE ?').all(`${DUP_SCAN_STATE_KEY}%`)).toEqual([]);
    expect(() => invalidateDuplicateScan(ctx.sqlite)).not.toThrow();
  });

  it('falls back to a full scan for malformed state and rechecks updated rows', async () => {
    ctx = makeDb();
    const a = await add('A', 'shared alpha details', 'pattern'); const b = await add('B', 'shared alpha details', 'decision');
    await scanDuplicatePairs(ctx.sqlite, 0.8);
    ctx.sqlite.prepare('UPDATE cleanup_meta SET value = ? WHERE key = ?').run('{bad', dupScanStateKey(0.8));
    expect((await scanDuplicatePairs(ctx.sqlite, 0.8)).mode).toBe('full');
    // Malformed state is replaced by a valid full-scan cache on the following run.
    const recovered = await scanDuplicatePairs(ctx.sqlite, 0.8);
    expect(recovered.mode).toBe('incremental');
    expect(recovered.compared).toBeGreaterThan(0);
    expect(recovered.pairs).toHaveLength(1);
  });

  it('supports forced full mode and pair-cap truncated results', async () => {
    ctx = makeDb(); await add('A', 'same words here', 'pattern'); await add('B', 'same words here', 'decision'); await add('C', 'same words here', 'warning');
    const first = await scanDuplicatePairs(ctx.sqlite, 0.5, { incremental: false, maxPairs: 1 });
    expect(first.mode).toBe('full');
    expect(first.truncated).toBe(true);
    const again = await scanDuplicatePairs(ctx.sqlite, 0.5, { incremental: false });
    expect(again.pairs).toHaveLength(3);
  });

  it('deduplicates concurrent requests for the same database and scan key', async () => {
    ctx = makeDb(); await add('A', 'same words');
    const [a, b] = await Promise.all([scanDuplicatePairs(ctx.sqlite, 0.5), scanDuplicatePairs(ctx.sqlite, 0.5)]);
    expect(a).toBe(b);
    expect(a.mode).toBe('full');
  });

  it('returns truncated empty scan above entry ceiling', async () => {
    ctx = makeDb();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stmt = ctx.sqlite.prepare(`INSERT INTO knowledge_entries (id, title, content, tags, scope, type, source, created_at, updated_at) VALUES (?, ?, '', '[]', 'global', 'pattern', 'test', '2026', '2026')`);
    const insertMany = ctx.sqlite.transaction(() => { for (let i = 0; i <= MAX_SCAN_ENTRIES; i++) stmt.run(`entry-${String(i).padStart(6, '0')}`, 'Entry'); });
    insertMany();
    const result = await scanDuplicatePairs(ctx.sqlite, 0.9);
    expect(result).toMatchObject({ pairs: [], compared: 0, mode: 'full', truncated: true });
    expect(result.meta.size).toBe(MAX_SCAN_ENTRIES + 1);
  });

  it('uses different state per threshold and maintains only three threshold entries', async () => {
    ctx = makeDb(); await add('A', 'some content');
    for (const threshold of [0.1, 0.2, 0.3, 0.4]) await scanDuplicatePairs(ctx.sqlite, threshold);
    const keys = ctx.sqlite.prepare('SELECT value FROM cleanup_meta WHERE key = ?').get(DUP_SCAN_STATE_KEY) as { value: string };
    expect(JSON.parse(keys.value)).toEqual(['0.4', '0.3', '0.2']);
    expect(ctx.sqlite.prepare('SELECT value FROM cleanup_meta WHERE key = ?').get(dupScanStateKey(0.1))).toBeUndefined();
  });
});
