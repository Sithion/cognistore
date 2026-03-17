export { createDbClient, type Database, type SQLiteDatabase } from './db/index.js';
export { runMigrations } from './db/index.js';
export { knowledgeEntries, knowledgeTypeEnum } from './db/index.js';
export {
  createEmbeddingsTable,
  insertEmbedding,
  updateEmbedding,
  deleteEmbedding,
  searchKnn,
} from './db/index.js';
export { KnowledgeRepository } from './repositories/index.js';
export { KnowledgeService, type EmbeddingProvider } from './services/index.js';
