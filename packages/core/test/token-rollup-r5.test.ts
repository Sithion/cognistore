import { afterEach, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { makeDb } from './helpers.js';
import { TokenUsageRepository } from '../src/repositories/token-usage.repository.js';
import { TokenUsageService } from '../src/services/token-usage/service.js';
import type { TokenUsageRecord } from '../src/services/token-usage/types.js';
import type { TokenSourceAdapter } from '../src/services/token-usage/adapter.js';

let ctx: ReturnType<typeof makeDb> | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });
const range = { from: '2026-10-01T00:00:00', to: '2026-10-03T23:59:59.999Z' };
function record(id: string, project: string | null, occurredAt: string, inputTokens: number,
  source = 'claude-code', model = 'm1'): TokenUsageRecord {
  return { id, project, occurredAt, inputTokens, source, model,
    sessionId: id, messageId: id, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 };
}
const fixed = [
  record('a', null, '2026-10-01T10:00:00Z', 10),
  record('b', '', '2026-10-01T11:00:00Z', 20),
  record('c', 'p', '2026-10-02T00:30:00+02:00', 30, 'copilot-cli', 'm2'),
  record('d', 'p', '2026-10-02T12:00:00Z', 40, 'copilot-cli', 'm2'),
];

it('preserves exact counters, NULL/empty groups, lexical days, filters and retained edges', async () => {
  ctx = makeDb();
  const repo = new TokenUsageRepository(ctx.sqlite);
  expect(repo.insertMany(fixed)).toBe(4);
  expect(repo.insertMany(fixed)).toBe(0);
  const expected = { inputTokens: 100, outputTokens: 8, cacheReadTokens: 12, cacheCreationTokens: 16 };
  expect(repo.totals(range)).toEqual(expected);
  expect(repo.byDay(range)).toEqual([
    { date: '2026-10-01', inputTokens: 30, outputTokens: 4, cacheReadTokens: 6, cacheCreationTokens: 8 },
    { date: '2026-10-02', inputTokens: 70, outputTokens: 4, cacheReadTokens: 6, cacheCreationTokens: 8 },
  ]);
  expect(repo.byProject(range).map((r) => [r.project, r.inputTokens]).sort())
    .toEqual([['', 20], ['(unknown)', 10], ['p', 70]].sort());
  expect(repo.byModel(range).map((r) => [r.model, r.totalTokens]))
    .toEqual([['m2', 88], ['m1', 48]]);
  expect(repo.totals({ ...range, source: 'copilot-cli', model: 'm2', project: 'p' }))
    .toEqual({ inputTokens: 70, outputTokens: 4, cacheReadTokens: 6, cacheCreationTokens: 8 });
  expect(repo.totals({ from: '2026-10-01T10:00:00Z', to: '2026-10-01T10:00:00Z' }))
    .toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 });
  expect(repo.totals({ from: '2030-01-01', to: '2030-01-02' }))
    .toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  const service = new TokenUsageService(repo, []);
  expect(service.getAggregates(range).cacheEfficiency).toBe(12 / 128);
  expect(await repo.pruneBefore('2026-10-03T00:00:00Z')).toBe(4);
  expect(repo.totals(range)).toEqual(expected);
  expect(repo.byProject(range).map((r) => [r.project, r.inputTokens]).sort())
    .toEqual([['', 20], ['(unknown)', 10], ['p', 70]].sort());
  expect(repo.byHourDay(range)).toEqual([]);
  expect(repo.topSessions(range)).toEqual([]);
  expect(repo.totals({ from: '2026-10-01T10:00:00Z', to: '2026-10-01T10:00:00Z' }))
    .toEqual({ inputTokens: 30, outputTokens: 4, cacheReadTokens: 6, cacheCreationTokens: 8 });
});

it('survives prune, scan_state reset, current rescan, raw replay and reopen', async () => {
  ctx = makeDb();
  const repo = new TokenUsageRepository(ctx.sqlite);
  const adapter: TokenSourceAdapter = {
    name: 'claude-code',
    async *scan(getState) {
      if (getState('/fixed/session')) return;
      for (let i = 0; i < fixed.length; i++) {
        yield { record: fixed[i], filePath: '/fixed/session',
          byteOffset: i + 1, mtime: '2026-10-03T00:00:00Z' };
      }
    },
  };
  const service = new TokenUsageService(repo, [adapter]);
  expect((await service.scan()).inserted).toBe(4);
  const before = repo.totals(range);
  await repo.pruneBefore('2026-10-03T00:00:00Z');
  ctx.sqlite.exec('DELETE FROM scan_state');
  expect((await service.scan()).inserted).toBe(0);
  expect(repo.totals(range)).toEqual(before);
  const other = new BetterSqlite3(ctx.sqlite.name);
  try {
    other.prepare(`INSERT INTO token_usage
      (id,source,model,project,session_id,message_id,occurred_at,input_tokens,
       output_tokens,cache_read_tokens,cache_creation_tokens,scanned_at)
      VALUES ('a','claude-code','m1',NULL,'a','a','2026-10-01T10:00:00Z',10,2,3,4,'2026-10-04')`).run();
    expect(repo.totals(range)).toEqual(before);
    other.prepare(`INSERT INTO token_usage
      (id,source,model,project,occurred_at,input_tokens,output_tokens,
       cache_read_tokens,cache_creation_tokens,scanned_at)
      VALUES ('fresh','claude-code','m1',NULL,'2026-10-03T10:00:00Z',5,0,0,0,'2026-10-04')`).run();
    expect(repo.totals(range).inputTokens).toBe(105);
  } finally { other.close(); }
  await repo.pruneBefore('2026-10-02T00:00:00Z');
  expect(ctx.sqlite.prepare("SELECT value FROM token_usage_meta WHERE key='pruned_before'").get())
    .toEqual({ value: '2026-10-03T00:00:00.000Z' });
  const reopened = new BetterSqlite3(ctx.sqlite.name);
  try {
    expect(new TokenUsageRepository(reopened).totals(range).inputTokens).toBe(105);
    expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { reopened.close(); }
});

it('prunes 10001 rows in yielding batches and honors pre-cancellation', async () => {
  ctx = makeDb();
  const repo = new TokenUsageRepository(ctx.sqlite);
  repo.insertMany(Array.from({ length: 10001 }, (_, i) =>
    record(`old-${i}`, null, '2026-01-01T00:00:00Z', 1)));
  repo.insertMany([record('recent', null, '2026-10-01T00:00:00Z', 7)]);
  const aborted = new AbortController();
  aborted.abort();
  expect(await repo.pruneBefore('2026-09-01T00:00:00Z', { signal: aborted.signal })).toBe(0);
  let observed = -1;
  setImmediate(() => {
    observed = (ctx!.sqlite.prepare("SELECT count(*) AS n FROM token_usage WHERE id LIKE 'old-%'").get() as { n: number }).n;
  });
  expect(await repo.pruneBefore('2026-09-01T00:00:00Z')).toBe(10001);
  expect(observed).toBeGreaterThan(0);
  expect(observed).toBeLessThan(10001);
  expect(ctx.sqlite.prepare('SELECT id FROM token_usage').all()).toEqual([{ id: 'recent' }]);
  expect(ctx.sqlite.prepare('SELECT SUM(messages) AS n FROM token_usage_daily').get()).toEqual({ n: 10002 });
});

it('byProject keeps one (unknown) group across partial edges', () => {
  ctx = makeDb();
  const repo = new TokenUsageRepository(ctx.sqlite);
  repo.insertMany([
    record('n1', null, '2026-10-05T13:30:00.000Z', 1),
    record('e1', '', '2026-10-05T14:00:00.000Z', 2),
    record('a1', 'a', '2026-10-06T12:00:00.000Z', 3),
    record('last-ms', null, '2026-10-06T23:59:59.999Z', 7),
    record('n2', null, '2026-10-07T01:00:00.000Z', 4),
    record('e2', '', '2026-10-07T01:30:00.000Z', 5),
    record('a2', 'a', '2026-10-07T01:45:00.000Z', 6),
    record('out', 'a', '2026-10-07T02:01:00.000Z', 90),
  ]);
  const filter = { from: '2026-10-05T13:17:00.000Z', to: '2026-10-07T02:00:00.000Z' };
  const expected = ctx.sqlite.prepare(`SELECT COALESCE(project,'(unknown)') project, SUM(input_tokens) inputTokens
    FROM token_usage WHERE occurred_at >= ? AND occurred_at <= ? GROUP BY project ORDER BY project`).all(filter.from, filter.to);
  const rows = repo.byProject(filter);
  expect(rows.filter((row) => row.project === '(unknown)')).toHaveLength(1);
  expect(rows.filter((row) => row.project === '')).toHaveLength(1);
  expect(rows.filter((row) => row.project === 'a')).toHaveLength(1);
  expect(rows.map(({ project, inputTokens }) => ({ project, inputTokens })).sort((a,b) => a.project.localeCompare(b.project)))
    .toEqual(expected.sort((a: any,b: any) => a.project.localeCompare(b.project)));
  expect(rows.find((row) => row.project === '(unknown)')?.inputTokens).toBe(12);
});

it('returns empty aggregates for inverted ranges and accepts invalid lexical bounds', () => {
  ctx = makeDb();
  const repo = new TokenUsageRepository(ctx.sqlite);
  const inverted = { from: '2026-10-08T00:00:00Z', to: '2026-10-07T00:00:00Z' };
  expect(repo.totals(inverted)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  expect(repo.byDay(inverted)).toEqual([]);
  expect(repo.byModel(inverted)).toEqual([]);
  expect(repo.byProject(inverted)).toEqual([]);
  expect(() => repo.totals({ from: 'bogus', to: 'zzzz' })).not.toThrow();
});

it('floors retention cutoff to UTC day and counts the final millisecond of an edge day', async () => {
  ctx = makeDb();
  const repo = new TokenUsageRepository(ctx.sqlite);
  repo.insertMany([
    record('older', null, '2026-10-04T23:59:59.999Z', 1),
    record('at', null, '2026-10-05T00:00:00.000Z', 2),
    record('late', 'a', '2026-10-05T23:59:59.999Z', 3),
  ]);
  expect(await repo.pruneBefore('2026-10-05T15:00:00.000Z')).toBe(1);
  expect(ctx.sqlite.prepare('SELECT id FROM token_usage ORDER BY id').all()).toEqual([{ id: 'at' }, { id: 'late' }]);
  expect(ctx.sqlite.prepare("SELECT value FROM token_usage_meta WHERE key='pruned_before'").get())
    .toEqual({ value: '2026-10-05T00:00:00.000Z' });
  expect(repo.totals({ from: '2026-10-05T22:00:00.000Z', to: '2026-10-06T00:00:00.000Z' }).inputTokens).toBe(3);
});
