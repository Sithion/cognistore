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

/**
 * Read a stored embedding back as a plain number[]. vec0 returns the vector as a
 * raw float32 blob, so decode the buffer rather than assuming JSON. Returns null
 * when the id has no embedding (e.g. fresh row before insert).
 */
export function getEmbeddingById(sqlite: Database.Database, id: string): number[] | null {
  const row = sqlite
    .prepare(`SELECT embedding FROM ${VIRTUAL_TABLE_NAME} WHERE id = ?`)
    .get(id) as { embedding?: Buffer | Uint8Array } | undefined;
  if (!row || row.embedding == null) return null;
  const buf = row.embedding as Buffer;
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return Array.from(f32);
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
  /** vec0 rowid of each id (grows with every insert; used as a scan watermark). */
  rowids: number[];
  /** `ids.length × dims` float32 values, row-major, as stored (not normalized). */
  vectors: Float32Array;
  dims: number;
}

/**
 * Stream every knowledge embedding, one vec0 storage chunk (≤1024 vectors) at a
 * time, reading the vec0 shadow tables directly: `<table>_rowids` maps each id
 * to (chunk_id, chunk_offset) and holds live rows only, and
 * `<table>_vector_chunks00` holds each chunk as one float32 blob. A full scan of
 * the virtual table costs ~70 ms at 10k vectors in ONE synchronous call; this
 * costs ~1–2 ms per chunk, so the caller can yield between chunks.
 *
 * Falls back to a single virtual-table scan when the shadow layout is not the
 * one expected (another sqlite-vec version), so results never depend on it.
 */
export function* readEmbeddingsChunked(sqlite: Database.Database): Generator<EmbeddingChunk> {
  let layout: { rows: { id: string; rowid: number; chunk_id: number; chunk_offset: number }[]; chunkSql: string } | null = null;
  try {
    const rows = sqlite
      .prepare(`SELECT id, rowid, chunk_id, chunk_offset FROM ${VIRTUAL_TABLE_NAME}_rowids WHERE chunk_id IS NOT NULL ORDER BY chunk_id, chunk_offset`)
      .all() as { id: string; rowid: number; chunk_id: number; chunk_offset: number }[];
    const chunkSql = `SELECT c.size AS size, v.vectors AS vectors FROM ${VIRTUAL_TABLE_NAME}_chunks c JOIN ${VIRTUAL_TABLE_NAME}_vector_chunks00 v ON v.rowid = c.chunk_id WHERE c.chunk_id = ?`;
    sqlite.prepare(chunkSql); // throws if the shadow tables differ
    layout = { rows, chunkSql };
  } catch {
    layout = null;
  }

  if (!layout) {
    const rows = sqlite
      .prepare(`SELECT rowid, id, embedding FROM ${VIRTUAL_TABLE_NAME}`)
      .all() as { rowid: number; id: string; embedding: Buffer }[];
    if (rows.length === 0) return;
    const dims = Math.floor(rows[0].embedding.byteLength / 4);
    const vectors = new Float32Array(rows.length * dims);
    rows.forEach((r, i) => vectors.set(new Float32Array(r.embedding.buffer, r.embedding.byteOffset, dims), i * dims));
    yield { ids: rows.map((r) => r.id), rowids: rows.map((r) => r.rowid), vectors, dims };
    return;
  }

  const chunkStmt = sqlite.prepare(layout.chunkSql);
  let start = 0;
  while (start < layout.rows.length) {
    const chunkId = layout.rows[start].chunk_id;
    let end = start;
    while (end < layout.rows.length && layout.rows[end].chunk_id === chunkId) end++;
    const chunk = chunkStmt.get(chunkId) as { size: number; vectors: Buffer } | undefined;
    if (chunk && chunk.size > 0) {
      const dims = Math.floor(chunk.vectors.byteLength / 4 / chunk.size);
      const all = new Float32Array(chunk.vectors.buffer, chunk.vectors.byteOffset, chunk.size * dims);
      const members = layout.rows.slice(start, end);
      const vectors = new Float32Array(members.length * dims);
      members.forEach((m, i) => vectors.set(all.subarray(m.chunk_offset * dims, (m.chunk_offset + 1) * dims), i * dims));
      yield { ids: members.map((m) => m.id), rowids: members.map((m) => m.rowid), vectors, dims };
    }
    start = end;
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
