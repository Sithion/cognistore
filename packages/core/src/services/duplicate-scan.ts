import type Database from 'better-sqlite3';
import { readEmbeddingsChunked } from '../db/schema/sqlite-vec.js';
import { findPairsInVectors, normalizeRows, type GroupMember, type SimilarPair } from './duplicate-pairs.js';

/**
 * Duplicate detection without freezing the sidecar (plan v2.6, 1C.2 + 1C.3).
 *
 * Reads metadata without `content` (never `listAll()`), reads every vector once
 * straight from the vec0 storage chunks, then runs the cooperative exact pair
 * search. Every step yields to the event loop, so no synchronous slice comes
 * near 100 ms on a 10k-entry base.
 *
 * Incremental mode: the pairs found are kept in `cleanup_meta` under
 * `dup_scan_state`, with two watermarks — the highest vec0 rowid seen and the
 * highest `updated_at` seen. The next scan only compares the entries that are
 * new (rowid above the watermark) or edited (`updated_at` at or above it)
 * against everything, drops pairs whose entries are gone, and keeps the rest.
 * Anything that changes vectors without touching `updated_at` (re-embedding)
 * must call `invalidateDuplicateScan`. A missing, unreadable or mismatched
 * state (threshold, dimensions, rowids going backwards after the vec table was
 * rebuilt) falls back to a full scan.
 */

export const DUP_SCAN_STATE_KEY = 'dup_scan_state';
const STATE_VERSION = 1;
/** Thresholds kept in the state (Settings and the cleanup report may differ). */
const MAX_THRESHOLDS = 3;
/** Beyond this many pairs the state is not persisted (bounded `cleanup_meta` row). */
const MAX_PERSISTED_PAIRS = 50_000;

interface ThresholdState {
  dims: number;
  maxRowid: number;
  maxUpdated: string;
  savedAt: string;
  pairs: [string, string, number][];
}

interface ScanState {
  v: number;
  byThreshold: Record<string, ThresholdState>;
}

export interface DuplicateScanResult {
  pairs: SimilarPair[];
  meta: Map<string, GroupMember>;
  mode: 'full' | 'incremental';
  /** Entries compared against the whole base (all of them in a full scan). */
  compared: number;
}

const yieldToEventLoop = () => new Promise<void>((r) => setImmediate(r));

function readState(sqlite: Database.Database): ScanState {
  try {
    const row = sqlite.prepare('SELECT value FROM cleanup_meta WHERE key = ?').get(DUP_SCAN_STATE_KEY) as { value: string } | undefined;
    if (row) {
      const parsed = JSON.parse(row.value) as ScanState;
      if (parsed && parsed.v === STATE_VERSION && parsed.byThreshold && typeof parsed.byThreshold === 'object') return parsed;
    }
  } catch { /* corrupt or missing table: start over */ }
  return { v: STATE_VERSION, byThreshold: {} };
}

function writeState(sqlite: Database.Database, state: ScanState): void {
  try {
    sqlite
      .prepare('INSERT INTO cleanup_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(DUP_SCAN_STATE_KEY, JSON.stringify(state));
  } catch { /* best-effort cache: a busy or read-only DB just means a full scan next time */ }
}

/** Forget the incremental state: the next scan is a full one. */
export function invalidateDuplicateScan(sqlite: Database.Database): void {
  try {
    sqlite.prepare('DELETE FROM cleanup_meta WHERE key = ?').run(DUP_SCAN_STATE_KEY);
  } catch { /* nothing to invalidate */ }
}

function isValidThresholdState(s: unknown): s is ThresholdState {
  const t = s as ThresholdState;
  return !!t && typeof t.dims === 'number' && typeof t.maxRowid === 'number'
    && typeof t.maxUpdated === 'string' && Array.isArray(t.pairs);
}

export async function scanDuplicatePairs(
  sqlite: Database.Database,
  threshold: number,
  opts: { incremental?: boolean; yieldEveryMs?: number } = {},
): Promise<DuplicateScanResult> {
  const meta = new Map<string, GroupMember>();
  let maxUpdated = '';
  for (const r of sqlite
    .prepare(`SELECT id, title, scope, type, version, updated_at AS updatedAt FROM knowledge_entries WHERE type != 'system'`)
    .iterate() as Iterable<GroupMember>) {
    meta.set(r.id, { id: r.id, title: r.title, scope: r.scope, type: r.type, version: r.version ?? 1, updatedAt: r.updatedAt });
    if (r.updatedAt > maxUpdated) maxUpdated = r.updatedAt;
  }
  await yieldToEventLoop();

  // Every vector once, chunk by chunk, keeping only non-system entries.
  const ids: string[] = [];
  const rowids: number[] = [];
  const parts: Float32Array[] = [];
  let dims = 0;
  let maxRowid = 0;
  for (const chunk of readEmbeddingsChunked(sqlite)) {
    dims = chunk.dims;
    const keep: number[] = [];
    chunk.ids.forEach((id, i) => {
      if (chunk.rowids[i] > maxRowid) maxRowid = chunk.rowids[i];
      if (meta.has(id)) keep.push(i);
    });
    const part = new Float32Array(keep.length * dims);
    keep.forEach((i, k) => {
      ids.push(chunk.ids[i]);
      rowids.push(chunk.rowids[i]);
      part.set(chunk.vectors.subarray(i * dims, (i + 1) * dims), k * dims);
    });
    parts.push(part);
    await yieldToEventLoop();
  }
  const vectors = new Float32Array(ids.length * dims);
  let offset = 0;
  for (const p of parts) { vectors.set(p, offset); offset += p.length; }
  const set = { ids, vectors, dims };
  normalizeRows(set);
  await yieldToEventLoop();

  const key = String(threshold);
  const state = readState(sqlite);
  const prev = state.byThreshold[key];
  let mode: 'full' | 'incremental' = 'full';
  let pairs: SimilarPair[];
  let compared = ids.length;

  const canIncrement = opts.incremental !== false && isValidThresholdState(prev)
    && prev.dims === dims && maxRowid >= prev.maxRowid;
  const changedRows: number[] = [];
  if (canIncrement) {
    ids.forEach((id, i) => {
      if (rowids[i] > prev.maxRowid || meta.get(id)!.updatedAt >= prev.maxUpdated) changedRows.push(i);
    });
  }

  if (canIncrement && changedRows.length <= ids.length / 2) {
    mode = 'incremental';
    compared = changedRows.length;
    const present = new Set(ids);
    const changed = new Set(changedRows.map((i) => ids[i]));
    const kept = prev.pairs
      .filter(([a, b]) => present.has(a) && present.has(b) && !changed.has(a) && !changed.has(b))
      .map(([a, b, similarity]) => ({ a, b, similarity }));
    const fresh = changedRows.length
      ? await findPairsInVectors(set, threshold, { queryRows: changedRows, yieldEveryMs: opts.yieldEveryMs })
      : [];
    pairs = kept.concat(fresh);
  } else {
    pairs = await findPairsInVectors(set, threshold, { yieldEveryMs: opts.yieldEveryMs });
  }

  if (pairs.length <= MAX_PERSISTED_PAIRS) {
    state.byThreshold[key] = {
      dims, maxRowid, maxUpdated, savedAt: new Date().toISOString(),
      pairs: pairs.map((p) => [p.a, p.b, p.similarity]),
    };
    const keys = Object.keys(state.byThreshold)
      .sort((x, y) => (state.byThreshold[y].savedAt ?? '').localeCompare(state.byThreshold[x].savedAt ?? ''));
    for (const old of keys.slice(MAX_THRESHOLDS)) delete state.byThreshold[old];
    writeState(sqlite, state);
  }

  return { pairs, meta, mode, compared };
}
