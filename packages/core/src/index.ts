export { createDbClient, type Database } from './db/index.js';
export { runMigrations } from './db/index.js';
export { knowledgeEntries, knowledgeTypeEnum, vector } from './db/index.js';
export { KnowledgeRepository } from './repositories/index.js';
export { KnowledgeService, type EmbeddingProvider } from './services/index.js';
export { DockerManager, type DockerStatus, type ContainerInfo } from './docker/index.js';
