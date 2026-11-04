/**
 * Exact near-duplicate pair search over in-memory vectors (plan v2.6, 1C.3).
 * Pure: no database access, so it can move to a worker thread unchanged.
 *
 * Every pair (i, j) with cosine similarity ≥ threshold is found — the exact
 * threshold graph, which the old per-entry KNN (k = 20) only approximated.
 * Cost stays O(n²) dot products, so instead of being fast enough to run
 * inline it is made cooperative: it yields to the event loop with
 * `setImmediate` whenever it has run for `yieldEveryMs`, keeping each
 * synchronous slice well under the 100 ms freeze budget.
 *
 * Exact pruning: with unit vectors split into a head (first HEAD dims) and a
 * tail, cos(a, b) ≤ head(a)·head(b) + |tail(a)|·|tail(b)| (Cauchy–Schwarz), so
 * most pairs are rejected after HEAD multiplications instead of `dims`.
 */

export interface PairVectors {
  ids: string[];
  /** ids.length × dims, row-major. Rows are normalized in place by `normalizeRows`. */
  vectors: Float32Array;
  dims: number;
}

export interface SimilarPair {
  /** Canonical order: a < b (string comparison), matching the old KNN path. */
  a: string;
  b: string;
  similarity: number;
}

/** Dimensions in the pruning head; the tail norm bounds the rest. */
const HEAD = 64;

/**
 * Safety cap on collected pairs. m near-identical entries make m(m-1)/2 pairs,
 * so a runaway import of thousands of copies would otherwise hold millions of
 * objects. Hitting it stops the search and flags the result `truncated` (the
 * groups it already found are still reported).
 */
export const DUP_PAIR_CAP = 20_000;

/** Normalize one row to unit length in place and return its tail norm. */
export function normalizeRow(vectors: Float32Array, row: number, dims: number): number {
  const off = row * dims;
  let sum = 0;
  for (let d = 0; d < dims; d++) sum += vectors[off + d] * vectors[off + d];
  const mag = Math.sqrt(sum);
  if (mag > 0) for (let d = 0; d < dims; d++) vectors[off + d] /= mag;
  let tail = 0;
  for (let d = off + Math.min(HEAD, dims); d < off + dims; d++) tail += vectors[d] * vectors[d];
  return Math.sqrt(tail);
}

/** Normalize every row to unit length (zero rows stay zero). Synchronous: small sets only. */
export function normalizeRows(set: PairVectors): void {
  for (let r = 0; r < set.ids.length; r++) void normalizeRow(set.vectors, r, set.dims);
}

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

export interface PairSearchResult {
  pairs: SimilarPair[];
  /** True when DUP_PAIR_CAP (or `maxPairs`) stopped the search early. */
  truncated: boolean;
}

/**
 * Find all pairs with similarity ≥ threshold. `queryRows` (row indexes)
 * restricts the search to pairs touching at least one of those rows — the
 * incremental mode; omitted, every pair is checked. Rows must be normalized;
 * `tailNorm` (per row, as returned by `normalizeRow`) is computed if omitted.
 */
export async function findPairsInVectors(
  set: PairVectors,
  threshold: number,
  opts: { queryRows?: number[]; yieldEveryMs?: number; tailNorm?: Float64Array; maxPairs?: number; checkpoint?: (done: number, total: number) => Promise<void> } = {},
): Promise<PairSearchResult> {
  const { ids, vectors, dims } = set;
  const n = ids.length;
  const head = Math.min(HEAD, dims);
  const yieldEveryMs = opts.yieldEveryMs ?? 15;
  const maxPairs = opts.maxPairs ?? DUP_PAIR_CAP;
  const total = opts.queryRows?.length ?? (n * (n - 1)) / 2;
  let done = 0;
  let sliceStart = performance.now();
  let lastCheckpoint = sliceStart;
  const maybeYield = async () => {
    if (performance.now() - sliceStart >= yieldEveryMs) {
      await yieldToEventLoop();
      sliceStart = performance.now();
      if (performance.now() - lastCheckpoint >= 50) {
        await opts.checkpoint?.(done, total);
        lastCheckpoint = performance.now();
      }
    }
  };

  let tailNorm = opts.tailNorm;
  if (!tailNorm) {
    tailNorm = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      let s = 0;
      for (let d = r * dims + head; d < (r + 1) * dims; d++) s += vectors[d] * vectors[d];
      tailNorm[r] = Math.sqrt(s);
      if ((r & 1023) === 0) await maybeYield();
    }
  }

  const isQuery = opts.queryRows ? new Uint8Array(n) : null;
  if (isQuery) for (const r of opts.queryRows!) isQuery[r] = 1;
  const rowCount = opts.queryRows ? opts.queryRows.length : n;

  const pairs: SimilarPair[] = [];
  for (let k = 0; k < rowCount; k++) {
    const i = opts.queryRows ? opts.queryRows[k] : k;
    const oi = i * dims;
    const ti = tailNorm[i];
    // Full mode: j > i. Incremental: every j, except query rows already paired as i.
    for (let j = isQuery ? 0 : i + 1; j < n; j++) {
      // Dense clusters make every pair pay the full product: check the clock here too.
      if ((j & 2047) === 0) await maybeYield();
      if (j === i) continue;
      if (isQuery?.[j] && j < i) continue;
      const oj = j * dims;
      done++;
      let dot = 0;
      for (let d = 0; d < head; d++) dot += vectors[oi + d] * vectors[oj + d];
      if (dot + ti * tailNorm[j] < threshold) continue;
      for (let d = head; d < dims; d++) dot += vectors[oi + d] * vectors[oj + d];
      if (dot >= threshold) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        pairs.push({ a, b, similarity: dot });
        if (pairs.length >= maxPairs) return { pairs, truncated: true };
      }
    }
    await maybeYield();
  }
  return { pairs, truncated: false };
}

export interface GroupMember {
  id: string;
  title: string;
  scope: string;
  type: string;
  version: number;
  updatedAt: string;
}

export interface DuplicateGroup {
  groupId: string;
  maxSimilarity: number;
  members: GroupMember[];
}

/**
 * Union-find over pair endpoints → connected components, so N copies of one
 * entry render as ONE group. Members: version DESC, then updatedAt DESC;
 * groupId = smallest member id; groups: size DESC, then similarity DESC.
 * Pairs whose endpoints are missing from `meta` are ignored.
 */
export function groupPairs(pairs: SimilarPair[], meta: Map<string, GroupMember>, limit: number): DuplicateGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (cur !== root) { const next = parent.get(cur)!; parent.set(cur, root); cur = next; }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const live = pairs.filter((p) => meta.has(p.a) && meta.has(p.b));
  for (const p of live) union(p.a, p.b);
  const grouped = new Map<string, GroupMember[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const arr = grouped.get(root) ?? [];
    arr.push(meta.get(id)!);
    grouped.set(root, arr);
  }
  const maxSim = new Map<string, number>();
  for (const p of live) {
    const root = find(p.a);
    maxSim.set(root, Math.max(maxSim.get(root) ?? 0, p.similarity));
  }

  return Array.from(grouped.entries())
    .map(([root, members]) => {
      members.sort((a, b) => (b.version - a.version) || b.updatedAt.localeCompare(a.updatedAt));
      // IDs are strings; keep the canonical group ID in lexicographic order.
      // biome-ignore lint/complexity/useMathMinMax: Math.min would coerce UUIDs to NaN.
      const groupId = members.reduce((min, m) => m.id < min ? m.id : min, members[0].id);
      return { groupId, maxSimilarity: maxSim.get(root) ?? 0, members, memberCount: members.length };
    })
    .sort((x, y) => (y.members.length - x.members.length) || (y.maxSimilarity - x.maxSimilarity))
    .slice(0, limit);
}
