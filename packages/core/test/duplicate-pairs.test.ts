import { describe, expect, it } from 'vitest';
import { DUP_PAIR_CAP, findPairsInVectors, groupPairs, normalizeRow, normalizeRows, type GroupMember, type PairVectors } from '../src/services/duplicate-pairs.js';

const member = (id: string, version = 1, updatedAt = '2026-01-01'): GroupMember => ({ id, title: id, scope: 'global', type: 'pattern', version, updatedAt });
const vectors = (ids: string[], rows: number[][]): PairVectors => ({ ids, dims: rows[0]?.length ?? 0, vectors: new Float32Array(rows.flat()) });

describe('duplicate pair primitives', () => {
  it('normalizes nonzero rows and leaves zero rows unchanged', () => {
    const v = new Float32Array([3, 4, 0, 0]);
    expect(normalizeRow(v, 0, 2)).toBe(0);
    expect(Array.from(v.slice(0, 2))[0]).toBeCloseTo(0.6);
    expect(Array.from(v.slice(0, 2))[1]).toBeCloseTo(0.8);
    expect(normalizeRow(v, 1, 2)).toBe(0);
    const set = vectors(['a', 'b'], [[0, 2], [0, 0]]);
    normalizeRows(set);
    expect(Array.from(set.vectors)).toEqual([0, 1, 0, 0]);
  });

  it('finds canonical pairs at threshold and excludes below-threshold and self-pairs', async () => {
    const set = vectors(['z', 'a', 'm'], [[1, 0], [1, 0], [0, 1]]);
    const result = await findPairsInVectors(set, 1);
    expect(result).toEqual({ pairs: [{ a: 'a', b: 'z', similarity: 1 }], truncated: false });
    expect((await findPairsInVectors(set, 1.01)).pairs).toEqual([]);
  });

  it('restricts incremental results to pairs touching a query row without duplication', async () => {
    const set = vectors(['a', 'b', 'c'], [[1, 0], [1, 0], [1, 0]]);
    const result = await findPairsInVectors(set, 0.99, { queryRows: [1, 2] });
    expect(result.pairs.map(({ a, b }) => `${a}${b}`)).toEqual(['ab', 'bc', 'ac']);
  });

  it('uses tail norms to prune dissimilar vectors and accepts caller norms', async () => {
    const rows = Array.from({ length: 65 }, (_, i) => Array.from({ length: 65 }, (_, d) => d === i ? 1 : 0));
    const set = vectors(['a', 'b'], [rows[0], rows[64]]);
    expect((await findPairsInVectors(set, 0.9)).pairs).toEqual([]);
    const same = vectors(['a', 'b'], [[1, 0], [1, 0]]);
    expect((await findPairsInVectors(same, 1, { tailNorm: new Float64Array([0, 0]) })).pairs).toHaveLength(1);
  });

  it('truncates when the requested pair cap is reached', async () => {
    const set = vectors(['a', 'b', 'c'], [[1, 0], [1, 0], [1, 0]]);
    expect(await findPairsInVectors(set, 0.9, { maxPairs: 1 })).toMatchObject({ pairs: [{ a: 'a', b: 'b' }], truncated: true });
    expect(DUP_PAIR_CAP).toBeGreaterThan(1);
  });

  it('ignores pairs with missing metadata and returns empty for no live pairs', () => {
    expect(groupPairs([{ a: 'a', b: 'absent', similarity: 1 }], new Map([['a', member('a')]]), 10)).toEqual([]);
  });

  it('forms connected groups, sorts members and groups, and caps the result', () => {
    const meta = new Map([['a', member('a', 1, '2026-01-01')], ['b', member('b', 3)], ['c', member('c', 3, '2026-02-01')], ['d', member('d')], ['e', member('e')]]);
    const groups = groupPairs([
      { a: 'a', b: 'b', similarity: 0.91 }, { a: 'b', b: 'c', similarity: 0.95 },
      { a: 'd', b: 'e', similarity: 0.99 },
    ], meta, 1);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe('a');
    expect(groups[0].maxSimilarity).toBe(0.95);
    expect(groups[0].members.map((m) => m.id)).toEqual(['c', 'b', 'a']);
    expect(groupPairs([{ a: 'd', b: 'e', similarity: 0.99 }, { a: 'a', b: 'b', similarity: 0.91 }], meta, 5).map((g) => g.groupId)).toEqual(['d', 'a']);
  });

  it('sorts tied versions by latest update and respects nonpositive limits', () => {
    const meta = new Map([['a', member('a', 2, '2026-01-01')], ['b', member('b', 2, '2026-02-01')]]);
    expect(groupPairs([{ a: 'a', b: 'b', similarity: 0.8 }], meta, 5)[0].members.map((m) => m.id)).toEqual(['b', 'a']);
    expect(groupPairs([{ a: 'a', b: 'b', similarity: 0.8 }], meta, 0)).toEqual([]);
  });
});
