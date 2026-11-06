import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from './helpers.js';

describe('conservative tag suggestions', () => {
  let ctx: ReturnType<typeof makeDb>;

  beforeEach(() => { ctx = makeDb(); });
  afterEach(() => {
    ctx.service.stopPendingWriteTimers();
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  const accepted = [
    ['nest.js', 'nestjs'],
    ['user-home', 'user_home'],
    ['settings.json', 'settings-json'],
    ['regression-test', 'regression-tests'],
    ['subagent', 'subagents'],
    ['callback', 'callbacks'],
    ['modal', 'modals'],
    ['box', 'boxes'],
    ['class', 'classes'],
    ['match', 'matches'],
    ['dish', 'dishes'],
    ['buzz', 'buzzes'],
  ];

  const rejected = [
    ['modal', 'models'],
    ['blocking', 'mocking'],
    ['blocking', 'locking'],
    ['fallback', 'callback'],
    ['v0.2.0', 'v0.8.0'],
    ['phase-13', 'phase-4'],
    ['adr-0014', 'adr-0020'],
    ['round-9', 'round-7'],
    ['contract-test', 'test-contract'],
    ['redis', 'rediss'],
    ['v1-2', 'v12'],
    ['foo+bar', 'foobar'],
  ];

  function tags(...values: string[]) {
    vi.spyOn(ctx.repository, 'tagCounts').mockReturnValue(
      values.map((tag, index) => ({ tag, count: index + 2 })),
    );
  }

  it.each(accepted)('accepts %s / %s at 0.95', async (a, b) => {
    tags(a, b);
    expect(await ctx.service.suggestTagMerges()).toEqual([
      { a, b, similarity: 0.95, countA: 2, countB: 3 },
    ]);
  });

  it.each(rejected)('rejects %s / %s even with threshold zero', async (a, b) => {
    tags(a, b);
    expect(await ctx.service.suggestTagMerges(0)).toEqual([]);
  });

  it('scores lowercase/trim equality as one', async () => {
    tags(' Redis ', 'redis');
    expect(await ctx.service.suggestTagMerges(1)).toEqual([
      { a: ' Redis ', b: 'redis', similarity: 1, countA: 2, countB: 3 },
    ]);
  });

  it('does not suggest empty or separator-only canonical forms', async () => {
    tags('', ' ', '.', '/', '_');
    expect(await ctx.service.suggestTagMerges(0)).toEqual([]);
  });

  it('honors thresholds and sorts exact matches before canonical variants', async () => {
    tags('nest.js', 'nestjs', 'Redis', 'redis');
    expect((await ctx.service.suggestTagMerges(0.95)).map(p => p.similarity)).toEqual([1, 0.95]);
    expect((await ctx.service.suggestTagMerges(0.96)).map(p => p.similarity)).toEqual([1]);
    expect(await ctx.service.suggestTagMerges(1.01)).toEqual([]);
  });

  it('compares only pairs in the same canonical and digit bucket', async () => {
    tags(...Array.from({ length: 1000 }, (_, index) => `tag-${index}`), 'nest.js', 'nestjs', 'v1-2', 'v12');
    const similarity = vi.spyOn(ctx.service as any, 'tagSimilarity');
    const result = await ctx.service.suggestTagMerges();
    expect(result).toHaveLength(1);
    expect(similarity).toHaveBeenCalledTimes(1);
    expect(similarity).toHaveBeenCalledWith('nest.js', 'nestjs');
  });

  it('emits all equivalent pairs once with their original usage counts', async () => {
    tags('user-home', 'user_home', 'user/home');
    expect(await ctx.service.suggestTagMerges()).toEqual([
      { a: 'user-home', b: 'user_home', similarity: 0.95, countA: 2, countB: 3 },
      { a: 'user-home', b: 'user/home', similarity: 0.95, countA: 2, countB: 4 },
      { a: 'user_home', b: 'user/home', similarity: 0.95, countA: 3, countB: 4 },
    ]);
  });
});
