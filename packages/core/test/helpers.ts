import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient } from '../src/db/client.js';
import { KnowledgeRepository } from '../src/repositories/knowledge.repository.js';
import { KnowledgeService, type EmbeddingProvider } from '../src/services/knowledge.service.js';

export const DIMS = 256;

/**
 * Deterministic embedding: a bag of character trigrams hashed into DIMS
 * buckets, L2-normalised. Texts sharing words land close together, unrelated
 * ones far apart — enough for search, dedup and duplicate-detection tests
 * without Ollama.
 */
export function stubEmbedding(text: string): number[] {
  const v = new Array(DIMS).fill(0);
  const s = ` ${text.toLowerCase()} `;
  for (let i = 0; i + 3 <= s.length; i++) {
    let h = 2166136261;
    for (let j = i; j < i + 3; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619);
    v[(h >>> 0) % DIMS] += 1;
  }
  const m = Math.hypot(...v) || 1;
  return v.map((x) => x / m);
}

export const stubEmbedder: EmbeddingProvider & { calls: string[] } = {
  calls: [],
  async embed(text: string) {
    this.calls.push(text);
    return stubEmbedding(text);
  },
};

/** A fresh database on disk (createDbClient needs a real path), with its cleanup. */
export function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cognistore-core-unit-'));
  const { db, sqlite } = createDbClient(join(dir, 'knowledge.db'));
  const repository = new KnowledgeRepository(db, sqlite);
  const service = new KnowledgeService(repository, stubEmbedder);
  return {
    db, sqlite, repository, service,
    cleanup: () => { try { sqlite.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }); },
  };
}
