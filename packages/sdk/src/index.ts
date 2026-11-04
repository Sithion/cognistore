export { KnowledgeSDK } from './sdk.js';
export { resolveConfig } from './config.js';
// Opt-in [perf] monitor (plan v2.6, 1A.7) for processes that only depend on the SDK (the MCP server).
export { createPerfMonitor, type PerfMonitor } from '@cognistore/core';
export {
  KnowledgeBaseError,
  ConnectionError,
  EmbeddingError,
  ValidationError,
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
} from '@cognistore/shared';
