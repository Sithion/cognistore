export { createDbClient, type Database, type SQLiteDatabase } from './db/index.js';
export { JobRunner, type JobRunnerConfig } from './jobs/runner.js';
export { dispatchJobWithConnection } from './jobs/dispatch.js';
export type { JobKind, JobPayloads, JobResults, JobProgress, ParentMessage, WorkerMessage } from './jobs/protocol.js';
export { runMigrations, EMBEDDED_MIGRATIONS } from './db/index.js';
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
export type { CleanupReport, CleanupCandidate } from './services/knowledge.service.js';

// Plan lineage traversals live in ./services/plan-lineage.js and are deliberately
// NOT exported: KnowledgeService is the only path allowed to derive or rewrite a
// chain, so publishing them would hand any consumer a way around its validation.
// Chain shapes come from @cognistore/shared (PlanChain / PlanChainEntry).

// Cleanup cycle: pure merge policy. Exported so the sidecar's LLM orchestration
// and the apply path share one implementation of the merge invariants.
export {
  computeMergedTags,
  validateMergeDraft,
  deterministicMergeDraft,
  MergeDraftError,
  CLEANUP_CONTROL_TAGS,
  type MergeDraft,
  type MergeMember,
} from './services/cleanup-merge.js';

// Performance instrumentation (slow DB ops, SQLITE_BUSY, event-loop delay)
export {
  instrumentDatabase,
  startEventLoopMonitor,
  type SlowOpEvent,
  type DbOpStats,
  type DbInstrumentation,
  type EventLoopReport,
} from './perf/instrumentation.js';
export { createPerfMonitor, formatPerfSummary, type PerfMonitor, type PerfMonitorOptions } from './perf/monitor.js';

// Token usage
export { scanDuplicatePairs, invalidateDuplicateScan, DUP_SCAN_STATE_KEY, dupScanStateKey, MAX_SCAN_ENTRIES, type DuplicateScanResult } from './services/duplicate-scan.js';
export { findPairsInVectors, normalizeRows, groupPairs, DUP_PAIR_CAP, type SimilarPair, type DuplicateGroup, type GroupMember } from './services/duplicate-pairs.js';
export { readEmbeddingsChunked, readEmbeddingsByLookup, maxEmbeddingRowid, type EmbeddingChunk } from './db/schema/sqlite-vec.js';
export { TokenUsageRepository } from './repositories/token-usage.repository.js';
export { TokenUsageService } from './services/token-usage/service.js';
export { TokenUsageScanner, type ScanResult } from './services/token-usage/scanner.js';
export { ClaudeCodeAdapter } from './services/token-usage/adapters/claude-code.js';
export { CopilotCliAdapter } from './services/token-usage/adapters/copilot-cli.js';
export type { TokenSourceAdapter, ScannedTokenRecord } from './services/token-usage/adapter.js';
export type {
  TokenUsageRecord,
  TokenUsageFilter,
  TokenUsageAggregates,
  TokenUsageTotals,
  TokenUsageByDay,
  TokenUsageByModel,
  TokenUsageByProject,
  TokenUsageByHourDay,
  TopSession,
  ScanState,
} from './services/token-usage/types.js';
