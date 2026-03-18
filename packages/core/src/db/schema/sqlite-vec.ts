import type Database from 'better-sqlite3';

const VIRTUAL_TABLE_NAME = 'knowledge_embeddings';

export function createEmbeddingsTable(sqlite: Database.Database, dimensions = 384) {
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
  const stmt = sqlite.prepare(
    `UPDATE ${VIRTUAL_TABLE_NAME} SET embedding = ? WHERE id = ?`
  );
  stmt.run(Buffer.from(new Float32Array(embedding).buffer), id);
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
