import { describe, expect, it } from 'vitest';
import { PLAN_CHAIN_MAX_DEPTH, PLAN_CHAIN_MAX_ENTRIES } from '@cognistore/shared';
import { buildChain, collectDescendants, deriveRoot, isDescendant, recomputeSubtreeRoot, walkAncestors, type ChainRow } from '../src/services/plan-lineage.js';

function reader(rows: Record<string, { parent_plan_id?: string | null; root_plan_id?: string | null }>) {
  return { getPlanById: (id: string) => rows[id] ? { id, ...rows[id] } : null };
}
const row = (id: string, parent_plan_id: string | null = null, created_at = '2026-01-01'): ChainRow => ({
  id, title: ` ${id}\nTitle `, status: 'active', scope: 'global', parent_plan_id, root_plan_id: null, created_at,
});

describe('plan lineage primitives', () => {
  it('walks ancestors nearest first and handles absent starting ids', () => {
    const r = reader({ c: { parent_plan_id: 'b' }, b: { parent_plan_id: 'a' }, a: {} });
    expect(walkAncestors('c', r)).toEqual({ ancestors: ['c', 'b', 'a'], last: 'a', truncated: false });
    expect(walkAncestors('missing', r)).toEqual({ ancestors: ['missing'], last: 'missing', truncated: false });
  });

  it('marks cycles, dangling parents and depth caps correctly', () => {
    expect(walkAncestors('a', reader({ a: { parent_plan_id: 'b' }, b: { parent_plan_id: 'a' } })).truncated).toBe(true);
    expect(walkAncestors('a', reader({ a: { parent_plan_id: 'gone' } })).ancestors).toEqual(['a', 'gone']);
    expect(walkAncestors('a', reader({ a: { parent_plan_id: 'b' }, b: {} }), 1)).toEqual({ ancestors: ['a'], last: 'a', truncated: true });
    expect(walkAncestors('a', reader({}), 0)).toEqual({ ancestors: [], last: null, truncated: true });
  });

  it('derives a cached root, recovers a stale cache, and handles missing parents', () => {
    const r = reader({ root: {}, child: { parent_plan_id: 'root', root_plan_id: 'cached' }, stale: { parent_plan_id: 'root' } });
    expect(deriveRoot('child', r)).toBe('cached');
    expect(deriveRoot('root', r)).toBe('root');
    expect(deriveRoot('stale', r)).toBe('root');
    expect(deriveRoot('missing', r)).toBeNull();
  });

  it('checks self and ancestor membership', () => {
    const r = reader({ a: {}, b: { parent_plan_id: 'a' }, c: { parent_plan_id: 'b' } });
    expect(isDescendant('a', 'a', r)).toBe(true);
    expect(isDescendant('c', 'a', r)).toBe(true);
    expect(isDescendant('a', 'c', r)).toBe(false);
    expect(isDescendant('missing', 'a', r)).toBe(false);
  });

  it('builds breadth-first order, sanitizes titles and marks the current item', () => {
    const result = buildChain([row('child', 'root', '2026-02-01'), row('root'), row('grand', 'child'), row('sibling', 'root', '2026-01-02')], 'root', 'grand');
    expect(result.chain.map((x) => [x.id, x.depth])).toEqual([['root', 0], ['child', 1], ['sibling', 1], ['grand', 2]]);
    expect(result.chain[0].title).toBe('root Title');
    expect(result.chain.at(-1)?.isCurrent).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('orders equal-depth siblings by input order and appends detached rows as truncated', () => {
    const result = buildChain([row('orphan', 'absent'), row('root'), row('child', 'root')], 'root', 'x');
    expect(result.chain.map((x) => x.id)).toEqual(['root', 'child', 'orphan']);
    expect(result.chain[2].depth).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it('marks a full-sized chain truncated and guards repeated ids', () => {
    const rows = Array.from({ length: PLAN_CHAIN_MAX_ENTRIES }, (_, i) => row(`n${i}`, i ? `n${i - 1}` : null));
    const full = buildChain(rows, 'n0', 'n1');
    expect(full.chain).toHaveLength(PLAN_CHAIN_MAX_ENTRIES);
    expect(full.truncated).toBe(true);
    const cyclicDetached = buildChain([row('root'), row('child', 'root'), row('x', 'y'), row('y', 'x')], 'root', 'child');
    expect(cyclicDetached.chain.map((x) => x.id)).toEqual(['root', 'child', 'x', 'y']);
    expect(cyclicDetached.truncated).toBe(true);
    expect(PLAN_CHAIN_MAX_DEPTH).toBeGreaterThan(0);
  });

  it('collects descendants breadth-first with cycle and entry caps', () => {
    const graph: Record<string, { id: string }[]> = { a: [{ id: 'b' }, { id: 'c' }], b: [{ id: 'd' }, { id: 'a' }], c: [{ id: 'e' }], d: [], e: [] };
    expect(collectDescendants('a', { getChildPlans: (id) => graph[id] ?? [] })).toEqual(['b', 'c', 'd', 'e']);
    const huge: Record<string, { id: string }[]> = { a: Array.from({ length: PLAN_CHAIN_MAX_ENTRIES + 1 }, (_, i) => ({ id: `${i}` })) };
    expect(collectDescendants('a', { getChildPlans: (id) => huge[id] ?? [] })).toHaveLength(PLAN_CHAIN_MAX_ENTRIES);
  });

  it('emits independent roots and grouped descendant rewrites', () => {
    const graph: Record<string, { id: string }[]> = { removed: [{ id: 'x' }, { id: 'y' }], x: [{ id: 'z' }], z: [], y: [] };
    expect(recomputeSubtreeRoot('removed', { getChildPlans: (id) => graph[id] ?? [] })).toEqual([
      { ids: ['x'], rootPlanId: null }, { ids: ['z'], rootPlanId: 'x' }, { ids: ['y'], rootPlanId: null },
    ]);
  });
});
