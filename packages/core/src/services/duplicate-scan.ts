import type Database from 'better-sqlite3';
import { readEmbeddingsChunked, maxEmbeddingRowid } from '../db/schema/sqlite-vec.js';
import { findPairsInVectors, normalizeRow, type GroupMember, type SimilarPair } from './duplicate-pairs.js';

/**
 * Duplicate detection without freezing the sidecar (plan v2.6, 1C.2 + 1C.3).
 *
 * Reads metadata without `content` (never `listAll()`) in keyset pages, reads
 * every vector once straight from the vec0 storage chunks into one
 * preallocated matrix (normalizing as it goes), then runs the cooperative
 * exact pair search. Every step yields to the event loop, so no synchronous
 * slice comes near 100 ms.
 *
 * Incremental mode: the pairs found are kept in `cleanup_meta`, one row per
 * threshold (`dup_scan_state:<threshold>`, plus `dup_scan_state` listing the
 * thresholds kept, most recent first), with two watermarks — the highest vec0
 * rowid seen and the highest `updated_at` seen. The next scan only compares
 * the entries that are new (rowid above the watermark) or edited (`updated_at`
 * at or above it) against everything, drops pairs whose entries are gone, and
 * keeps the rest. Anything that changes vectors without touching `updated_at`
 * (re-embedding) must call `invalidateDuplicateScan`. A missing, unreadable or
 * mismatched state (dimensions, rowids going backwards after the vec table was
 * rebuilt) or a truncated result falls back to a full scan.
 */

export const DUP_SCAN_STATE_KEY = 'dup_scan_state';
const STATE_VERSION = 1;
/** Thresholds kept (Settings and the cleanup report may differ). */
const MAX_THRESHOLDS = 3;
/** Beyond this many pairs the state is not persisted (bounded `cleanup_meta` rows, cheap JSON). */
const MAX_PERSISTED_PAIRS = 10_000;
/** Above this many entries the scan refuses to build the matrix (memory: entries × dims × 4 bytes). */
export const MAX_SCAN_ENTRIES = 100_000;
const META_PAGE = 5_000;
/** Short lock wait for the best-effort state write: never stall the sidecar behind an agent's write. */
const STATE_WRITE_BUSY_MS = 250;

interface ThresholdState {
  v: number;
  dims: number;
  maxRowid: number;
  maxUpdated: string;
  pairs: [string, string, number][];
}

export interface DuplicateScanResult {
  pairs: SimilarPair[];
  meta: Map<string, GroupMember>;
  mode: 'full' | 'incremental';
  /** Entries compared against the whole base (all of them in a full scan). */
  compared: number;
  /** The pair cap or the entry ceiling cut the scan short; groups may be incomplete. */
  truncated: boolean;
}

export const dupScanStateKey = (threshold: number) => `${DUP_SCAN_STATE_KEY}:${threshold}`;

/** Fingerprint used by the SDK result cache; includes vector and metadata watermarks. */
export function duplicateFingerprint(sqlite: Database.Database, threshold: number): string {
  try {
    const row = sqlite.prepare(`SELECT
      (SELECT COALESCE(MAX(rowid), 0) FROM knowledge_embeddings_rowids) AS maxRowid,
      (SELECT COALESCE(MAX(updated_at), '') FROM knowledge_entries WHERE type != 'system') AS maxUpdated,
      (SELECT COUNT(*) FROM knowledge_entries WHERE type != 'system') AS entries,
      (SELECT COUNT(*) FROM knowledge_embeddings_rowids) AS embeddings`).get() as { maxRowid: number; maxUpdated: string; entries: number; embeddings: number };
    const generation = sqlite.prepare('SELECT value FROM cleanup_meta WHERE key = ?').get('dup_scan_generation') as { value: string } | undefined;
    return `${threshold}|${row.maxRowid}|${row.maxUpdated}|${row.entries}|${row.embeddings}|${generation?.value ?? '0'}`;
  } catch { return `${threshold}|unavailable`; }
}

export async function findDuplicatePairsForJob(sqlite: Database.Database, opts: { threshold?: number; limit?: number } = {}, checkpoint?: (done: number, total: number) => Promise<void>) {
  const threshold = opts.threshold ?? 0.9;
  const limit = opts.limit ?? 100;
  const { pairs, meta } = await scanDuplicatePairs(sqlite, threshold, { checkpoint });
  return pairs.filter((p) => meta.has(p.a) && meta.has(p.b)).sort((a, b) => b.similarity - a.similarity).slice(0, clampDuplicateLimit(limit))
    .map((p) => ({ a: { id: p.a, title: meta.get(p.a)!.title }, b: { id: p.b, title: meta.get(p.b)!.title }, similarity: p.similarity }));
}

export async function findDuplicateGroupsForJob(sqlite: Database.Database, opts: { threshold?: number; limit?: number } = {}, checkpoint?: (done: number, total: number) => Promise<void>) {
  const threshold = opts.threshold ?? 0.9;
  const limit = opts.limit ?? 100;
  const { pairs, meta } = await scanDuplicatePairs(sqlite, threshold, { checkpoint });
  const { groupPairs } = await import('./duplicate-pairs.js');
  return groupPairs(pairs, meta, clampDuplicateLimit(limit)).map((group) => ({ ...group, memberCount: group.members.length, members: group.members.slice(0, 50) }));
}

export const clampDuplicateLimit = (limit: number) => Math.min(500, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 100)));

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

function readThresholdState(sqlite: Database.Database, threshold: number): ThresholdState | null {
  try {
    const row = sqlite.prepare('SELECT value FROM cleanup_meta WHERE key = ?').get(dupScanStateKey(threshold)) as { value: string } | undefined;
    if (!row) return null;
    const s = JSON.parse(row.value) as ThresholdState;
    const ok = s && s.v === STATE_VERSION && typeof s.dims === 'number' && typeof s.maxRowid === 'number'
      && typeof s.maxUpdated === 'string' && Array.isArray(s.pairs);
    return ok ? s : null;
  } catch {
    return null; // corrupt or missing table: start over
  }
}

function writeThresholdState(sqlite: Database.Database, threshold: number, state: ThresholdState): void {
  const previousBusy = sqlite.pragma('busy_timeout', { simple: true }) as number;
  try {
    sqlite.pragma(`busy_timeout = ${STATE_WRITE_BUSY_MS}`);
    const upsert = sqlite.prepare('INSERT INTO cleanup_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    sqlite.transaction(() => {
      const indexRow = sqlite.prepare('SELECT value FROM cleanup_meta WHERE key = ?').get(DUP_SCAN_STATE_KEY) as { value: string } | undefined;
      let kept: string[] = [];
      try { kept = JSON.parse(indexRow?.value ?? '[]'); } catch { /* rebuilt below */ }
      if (!Array.isArray(kept)) kept = [];
      const key = String(threshold);
      kept = [key, ...kept.filter((k) => k !== key)];
      for (const old of kept.slice(MAX_THRESHOLDS)) sqlite.prepare('DELETE FROM cleanup_meta WHERE key = ?').run(`${DUP_SCAN_STATE_KEY}:${old}`);
      upsert.run(DUP_SCAN_STATE_KEY, JSON.stringify(kept.slice(0, MAX_THRESHOLDS)));
      upsert.run(dupScanStateKey(threshold), JSON.stringify(state));
    })();
  } catch {
    /* best-effort cache: busy or read-only DB just means a full scan next time */
  } finally {
    try { sqlite.pragma(`busy_timeout = ${previousBusy}`); } catch { /* closed */ }
  }
}

/** Forget the incremental state: the next scan is a full one. */
export function invalidateDuplicateScan(sqlite: Database.Database): void {
  try {
    sqlite.prepare(`INSERT INTO cleanup_meta (key, value) VALUES ('dup_scan_generation', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`).run();
    sqlite.prepare(`DELETE FROM cleanup_meta WHERE key = ? OR key LIKE ?`).run(DUP_SCAN_STATE_KEY, `${DUP_SCAN_STATE_KEY}:%`);
  } catch { /* nothing to invalidate */ }
}

// One scan per (database, threshold) at a time: the Settings route and the
// cleanup report must not each build the full matrix.
const inFlight = new WeakMap<Database.Database, Map<string, Promise<DuplicateScanResult>>>();

export function scanDuplicatePairs(
  sqlite: Database.Database,
  threshold: number,
  opts: { incremental?: boolean; yieldEveryMs?: number; maxPairs?: number; checkpoint?: (done: number, total: number) => Promise<void> } = {},
): Promise<DuplicateScanResult> {
  const key = `${threshold}|${opts.incremental !== false}|${opts.maxPairs ?? ''}`;
  let perDb = inFlight.get(sqlite);
  if (!perDb) { perDb = new Map(); inFlight.set(sqlite, perDb); }
  const running = perDb.get(key);
  if (running) return running;
  const p = runScan(sqlite, threshold, opts).finally(() => perDb!.delete(key));
  perDb.set(key, p);
  return p;
}

async function runScan(
  sqlite: Database.Database,
  threshold: number,
  opts: { incremental?: boolean; yieldEveryMs?: number; maxPairs?: number; checkpoint?: (done: number, total: number) => Promise<void> },
): Promise<DuplicateScanResult> {
  // Snapshot the vector watermark BEFORE reading metadata: anything inserted
  // later is left for the next scan instead of being skipped for good.
  const capRowid = maxEmbeddingRowid(sqlite);

  const meta = new Map<string, GroupMember>();
  let metadataDone = 0;
  const metadataTotal = sqlite.prepare("SELECT COUNT(*) AS total FROM knowledge_entries WHERE type != 'system'").get() as { total: number };
  let maxUpdated = '';
  const page = sqlite.prepare(
    `SELECT id, title, scope, type, version, updated_at AS updatedAt FROM knowledge_entries
      WHERE type != 'system' AND id > ? ORDER BY id LIMIT ${META_PAGE}`,
  );
  for (let after = ''; ;) {
    const rows = page.all(after) as GroupMember[];
    for (const r of rows) {
      meta.set(r.id, { id: r.id, title: r.title, scope: r.scope, type: r.type, version: r.version ?? 1, updatedAt: r.updatedAt });
      if (r.updatedAt > maxUpdated) maxUpdated = r.updatedAt;
      metadataDone++;
    }
    await (opts.checkpoint ? opts.checkpoint(metadataDone, metadataTotal.total) : yieldToEventLoop());
    if (rows.length < META_PAGE) break;
    after = rows[rows.length - 1].id;
  }

  const empty = (truncated: boolean): DuplicateScanResult => ({ pairs: [], meta, mode: 'full', compared: 0, truncated });
  if (meta.size > MAX_SCAN_ENTRIES) {
    console.warn(`[CogniStore] duplicate scan skipped: ${meta.size} entries is above the ${MAX_SCAN_ENTRIES} ceiling`);
    return empty(true);
  }

  // Every vector once, chunk by chunk, into one preallocated matrix.
  const ids: string[] = [];
  const rowids: number[] = [];
  let hasRowids = capRowid !== null;
  let dims = 0;
  let vectors = new Float32Array(0);
  let tailNorm = new Float64Array(0);
  for (const chunk of readEmbeddingsChunked(sqlite, capRowid !== null ? { maxRowid: capRowid } : {})) {
    if (dims === 0) {
      dims = chunk.dims;
      vectors = new Float32Array(meta.size * dims);
      tailNorm = new Float64Array(meta.size);
    }
    if (chunk.dims !== dims) continue; // mixed dimensions: never compare across them
    if (!chunk.rowids) hasRowids = false;
    for (let i = 0; i < chunk.ids.length; i++) {
      if (!meta.has(chunk.ids[i]) || ids.length >= meta.size) continue;
      const row = ids.length;
      ids.push(chunk.ids[i]);
      rowids.push(chunk.rowids ? chunk.rowids[i] : 0);
      vectors.set(chunk.vectors.subarray(i * dims, (i + 1) * dims), row * dims);
      tailNorm[row] = normalizeRow(vectors, row, dims);
    }
    await (opts.checkpoint ? opts.checkpoint(ids.length, metadataTotal.total) : yieldToEventLoop());
  }
  if (ids.length === 0) return empty(false);
  const set = { ids, vectors: vectors.subarray(0, ids.length * dims), dims };
  const norms = tailNorm.subarray(0, ids.length);

  const prev = opts.incremental !== false && hasRowids ? readThresholdState(sqlite, threshold) : null;
  const canIncrement = !!prev && prev.dims === dims && capRowid! >= prev.maxRowid;
  const changedRows: number[] = [];
  if (canIncrement) {
    for (let i = 0; i < ids.length; i++) {
      if (rowids[i] > prev.maxRowid || meta.get(ids[i])!.updatedAt >= prev.maxUpdated) changedRows.push(i);
    }
  }

  let result: DuplicateScanResult;
  let changedSomething = true;
  if (canIncrement && changedRows.length <= ids.length / 2) {
    const present = new Set(ids);
    const changed = new Set(changedRows.map((i) => ids[i]));
    const kept = prev.pairs
      .filter(([a, b]) => present.has(a) && present.has(b) && !changed.has(a) && !changed.has(b))
      .map(([a, b, similarity]) => ({ a, b, similarity }));
    const fresh = changedRows.length
      ? await findPairsInVectors(set, threshold, { queryRows: changedRows, tailNorm: norms, yieldEveryMs: opts.yieldEveryMs, maxPairs: opts.maxPairs, checkpoint: opts.checkpoint })
      : { pairs: [], truncated: false };
    result = { pairs: kept.concat(fresh.pairs), meta, mode: 'incremental', compared: changedRows.length, truncated: fresh.truncated };
    // Entries sharing the newest updated_at are re-checked on every scan, so
    // "compared > 0" alone does not mean anything changed: compare the outcome.
    const prevKeys = new Set(prev.pairs.map(([a, b]) => `${a}|${b}`));
    changedSomething = capRowid !== prev.maxRowid || maxUpdated !== prev.maxUpdated
      || result.pairs.length !== prev.pairs.length || result.pairs.some((p) => !prevKeys.has(`${p.a}|${p.b}`));
  } else {
    const found = await findPairsInVectors(set, threshold, { tailNorm: norms, yieldEveryMs: opts.yieldEveryMs, maxPairs: opts.maxPairs, checkpoint: opts.checkpoint });
    result = { pairs: found.pairs, meta, mode: 'full', compared: ids.length, truncated: found.truncated };
  }

  if (hasRowids && changedSomething && !result.truncated && result.pairs.length <= MAX_PERSISTED_PAIRS) {
    writeThresholdState(sqlite, threshold, {
      v: STATE_VERSION, dims, maxRowid: capRowid!, maxUpdated,
      pairs: result.pairs.map((p) => [p.a, p.b, p.similarity]),
    });
  }
  return result;
}
