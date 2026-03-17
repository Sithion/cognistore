export { KnowledgeSDK } from './sdk.js';
export { resolveConfig } from './config.js';
export {
  KnowledgeBaseError,
  ConnectionError,
  EmbeddingError,
  ValidationError,
  DockerError,
} from './errors.js';

// Re-export types from shared for convenience
export type {
  KnowledgeEntry,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  SearchOptions,
  SearchResult,
  HealthStatus,
  SDKConfig,
  KnowledgeType,
} from '@ai-knowledge/shared';
