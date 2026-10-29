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

const HEAD = 64;

/** Normalize every row to unit length (zero rows stay zero). */
export function normalizeRows(set: PairVectors): void {
  const { vectors, dims } = set;
  for (let r = 0; r < set.ids.length; r++) {
    const off = r * dims;
    let sum = 0;
    for (let d = 0; d < dims; d++) sum += vectors[off + d] * vectors[off + d];
    const mag = Math.sqrt(sum);
    if (mag > 0) for (let d = 0; d < dims; d++) vectors[off + d] /= mag;
  }
}

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

/**
 * Find all pairs with similarity ≥ threshold. `queryRows` (row indexes)
 * restricts the search to pairs touching at least one of those rows — the
 * incremental mode; omitted, every pair is checked. Rows must be normalized.
 */
export async function findPairsInVectors(
  set: PairVectors,
  threshold: number,
  opts: { queryRows?: number[]; yieldEveryMs?: number } = {},
): Promise<SimilarPair[]> {
  const { ids, vectors, dims } = set;
  const n = ids.length;
  const head = Math.min(HEAD, dims);
  const yieldEveryMs = opts.yieldEveryMs ?? 15;

  const tailNorm = new Float64Array(n);
  for (let r = 0; r < n; r++) {
    let s = 0;
    for (let d = r * dims + head; d < (r + 1) * dims; d++) s += vectors[d] * vectors[d];
    tailNorm[r] = Math.sqrt(s);
  }

  const isQuery = opts.queryRows ? new Uint8Array(n) : null;
  if (isQuery) for (const r of opts.queryRows!) isQuery[r] = 1;
  const rows = opts.queryRows ?? Array.from({ length: n }, (_, i) => i);

  const pairs: SimilarPair[] = [];
  let sliceStart = performance.now();
  for (const i of rows) {
    const oi = i * dims;
    const ti = tailNorm[i];
    // Full mode: j > i. Incremental: every j, except query rows already paired as i.
    for (let j = isQuery ? 0 : i + 1; j < n; j++) {
      if (j === i) continue;
      if (isQuery && isQuery[j] && j < i) continue;
      const oj = j * dims;
      let dot = 0;
      for (let d = 0; d < head; d++) dot += vectors[oi + d] * vectors[oj + d];
      if (dot + ti * tailNorm[j] < threshold) continue;
      for (let d = head; d < dims; d++) dot += vectors[oi + d] * vectors[oj + d];
      if (dot >= threshold) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        pairs.push({ a, b, similarity: dot });
      }
    }
    if (performance.now() - sliceStart >= yieldEveryMs) {
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
  }
  return pairs;
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
      const groupId = members.reduce((min, m) => (m.id < min ? m.id : min), members[0].id);
      return { groupId, maxSimilarity: maxSim.get(root) ?? 0, members };
    })
    .sort((x, y) => (y.members.length - x.members.length) || (y.maxSimilarity - x.maxSimilarity))
    .slice(0, limit);
}
