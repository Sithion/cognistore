import type Database from 'better-sqlite3';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';

const VIRTUAL_TABLE_NAME = 'knowledge_embeddings';

export function createEmbeddingsTable(sqlite: Database.Database, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${VIRTUAL_TABLE_NAME} USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dimensions}] distance_metric=cosine
    )
  `);
}

export function insertEmbedding(sqlite: Database.Database, id: string, embedding: number[]) {
  const stmt = sqlite.prepare(
    `INSERT INTO ${VIRTUAL_TABLE_NAME}(id, embedding) VALUES (?, ?)`
  );
  stmt.run(id, Buffer.from(new Float32Array(embedding).buffer));
}

export function updateEmbedding(sqlite: Database.Database, id: string, embedding: number[]) {
  const buf = Buffer.from(new Float32Array(embedding).buffer);
  const stmt = sqlite.prepare(
    `UPDATE ${VIRTUAL_TABLE_NAME} SET embedding = ? WHERE id = ?`
  );
  const info = stmt.run(buf, id);
  if (info.changes === 0) insertEmbedding(sqlite, id, embedding);
}

export function deleteEmbedding(sqlite: Database.Database, id: string) {
  const stmt = sqlite.prepare(`DELETE FROM ${VIRTUAL_TABLE_NAME} WHERE id = ?`);
  stmt.run(id);
}

export interface KnnResult {
  id: string;
  distance: number;
}

export function searchKnn(
  sqlite: Database.Database,
  queryEmbedding: number[],
  k: number
): KnnResult[] {
  const stmt = sqlite.prepare(`
    SELECT id, distance
    FROM ${VIRTUAL_TABLE_NAME}
    WHERE embedding MATCH ?
      AND k = ?
  `);
  return stmt.all(
    Buffer.from(new Float32Array(queryEmbedding).buffer),
    k
  ) as KnnResult[];
}

/** One vec0 storage chunk worth of embeddings, decoded. */
export interface EmbeddingChunk {
  ids: string[];
  /**
   * vec0 rowid of each id (grows with every insert; used as a scan watermark).
   * `null` on the lookup fallback, where rowids are not available.
   */
  rowids: number[] | null;
  /** `ids.length × dims` float32 values, row-major, as stored (not normalized). */
  vectors: Float32Array;
  dims: number;
}

/** Highest vec0 rowid, or null when the shadow tables are not the expected ones. */
export function maxEmbeddingRowid(sqlite: Database.Database): number | null {
  try {
    const row = sqlite.prepare(`SELECT MAX(rowid) AS m FROM ${VIRTUAL_TABLE_NAME}_rowids`).get() as { m: number | null };
    return row.m ?? 0;
  } catch {
    return null;
  }
}

/**
 * Stream every knowledge embedding, one vec0 storage chunk (≤1024 vectors) at a
 * time, reading the vec0 shadow tables directly: `<table>_rowids` maps each id
 * to (chunk_id, chunk_offset) and holds live rows only, and
 * `<table>_vector_chunks00` holds each chunk as one float32 blob. A full scan of
 * the virtual table costs ~70 ms at 10k vectors in ONE synchronous call; this
 * costs ~1–2 ms per chunk, so the caller can yield between chunks.
 *
 * `maxRowid` skips rows inserted after the caller's snapshot. Falls back to
 * `readEmbeddingsByLookup` when the shadow layout is not the one expected
 * (another sqlite-vec version), so results never depend on it.
 */
export function* readEmbeddingsChunked(sqlite: Database.Database, opts: { maxRowid?: number } = {}): Generator<EmbeddingChunk> {
  type RowRef = { id: string; rowid: number; chunk_id: number; chunk_offset: number };
  let byChunk: Map<number, RowRef[]>;
  let chunkStmt: Database.Statement;
  try {
    const rows = sqlite
      .prepare(`SELECT id, rowid, chunk_id, chunk_offset FROM ${VIRTUAL_TABLE_NAME}_rowids WHERE chunk_id IS NOT NULL AND rowid <= ?`)
      .all(opts.maxRowid ?? Number.MAX_SAFE_INTEGER) as RowRef[];
    chunkStmt = sqlite.prepare(
      `SELECT c.size AS size, v.vectors AS vectors FROM ${VIRTUAL_TABLE_NAME}_chunks c JOIN ${VIRTUAL_TABLE_NAME}_vector_chunks00 v ON v.rowid = c.chunk_id WHERE c.chunk_id = ?`,
    );
    // Grouped in JS: an ORDER BY would sort the whole table in memory.
    byChunk = new Map();
    for (const r of rows) {
      const arr = byChunk.get(r.chunk_id);
      if (arr) arr.push(r); else byChunk.set(r.chunk_id, [r]);
    }
  } catch {
    yield* readEmbeddingsByLookup(sqlite);
    return;
  }

  for (const [chunkId, members] of byChunk) {
    const chunk = chunkStmt.get(chunkId) as { size: number; vectors: Buffer } | undefined;
    if (!chunk || chunk.size <= 0) continue;
    const dims = Math.floor(chunk.vectors.byteLength / 4 / chunk.size);
    const all = new Float32Array(chunk.vectors.buffer, chunk.vectors.byteOffset, chunk.size * dims);
    const vectors = new Float32Array(members.length * dims);
    members.forEach((m, i) => vectors.set(all.subarray(m.chunk_offset * dims, (m.chunk_offset + 1) * dims), i * dims));
    yield { ids: members.map((m) => m.id), rowids: members.map((m) => m.rowid), vectors, dims };
  }
}

/**
 * Fallback reader: primary-key lookups (`WHERE id = ?`) for every entry id, in
 * batches. Paging the virtual table itself costs O(n) per page, and vec0 with
 * a TEXT primary key exposes no rowid, so no watermark is available here.
 */
export function* readEmbeddingsByLookup(sqlite: Database.Database, batch = 256): Generator<EmbeddingChunk> {
  const ids = (sqlite.prepare('SELECT id FROM knowledge_entries').all() as { id: string }[]).map((r) => r.id);
  const get = sqlite.prepare(`SELECT embedding FROM ${VIRTUAL_TABLE_NAME} WHERE id = ?`);
  for (let start = 0; start < ids.length; start += batch) {
    const found: { id: string; embedding: Buffer }[] = [];
    for (const id of ids.slice(start, start + batch)) {
      const row = get.get(id) as { embedding?: Buffer } | undefined;
      if (row?.embedding) found.push({ id, embedding: row.embedding });
    }
    if (found.length === 0) continue;
    const dims = Math.floor(found[0].embedding.byteLength / 4);
    const vectors = new Float32Array(found.length * dims);
    found.forEach((r, i) => vectors.set(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, dims), i * dims));
    yield { ids: found.map((r) => r.id), rowids: null, vectors, dims };
  }
}

// ─── Plans embeddings ────────────────────────────────────────

const PLANS_TABLE_NAME = 'plans_embeddings';

export function insertPlanEmbedding(sqlite: Database.Database, id: string, embedding: number[]) {
  sqlite.prepare(`INSERT INTO ${PLANS_TABLE_NAME}(id, embedding) VALUES (?, ?)`).run(
    id,
    Buffer.from(new Float32Array(embedding).buffer),
  );
}

export function updatePlanEmbedding(sqlite: Database.Database, id: string, embedding: number[]) {
  const info = sqlite.prepare(`UPDATE ${PLANS_TABLE_NAME} SET embedding = ? WHERE id = ?`).run(
    Buffer.from(new Float32Array(embedding).buffer),
    id,
  );
  if (info.changes === 0) insertPlanEmbedding(sqlite, id, embedding);
}

export function deletePlanEmbedding(sqlite: Database.Database, id: string) {
  sqlite.prepare(`DELETE FROM ${PLANS_TABLE_NAME} WHERE id = ?`).run(id);
}

export function searchPlansKnn(
  sqlite: Database.Database,
  queryEmbedding: number[],
  k: number
): KnnResult[] {
  const stmt = sqlite.prepare(`
    SELECT id, distance
    FROM ${PLANS_TABLE_NAME}
    WHERE embedding MATCH ?
      AND k = ?
  `);
  return stmt.all(
    Buffer.from(new Float32Array(queryEmbedding).buffer),
    k
  ) as KnnResult[];
}
