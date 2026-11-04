export type JobKind = 'health' | 'duplicates.pairs' | 'duplicates.groups' | 'reembedAll' | 'embedMissing' | 'hashBackfill' | 'ftsBackfill' | 'importKnowledge' | 'importPlans' | 'exportToFile' | 'curation.run' | 'curation.resume' | 'curation.apply' | 'curation.reject' | 'curation.undo' | 'curation.purge' | 'curation.activity';
export type DuplicateJobOptions = { threshold?: number; limit?: number };
export type CurationJobOptions = { autonomy:'off'|'suggest'|'auto-safe'|'auto'; budgetMs:number; maxClusters:number; maxItems:number; trashRetentionDays:number; clusterThreshold:number; deprecatedUnreadDays:number; model:string; trigger:string; runId?:string; installedCurationModels?:string[] };
export type JobPayloads = {
  health: Record<string, unknown>;
  'duplicates.pairs': DuplicateJobOptions;
  'duplicates.groups': DuplicateJobOptions;
  reembedAll: Record<string, never>;
  embedMissing: Record<string, never>;
  hashBackfill: Record<string, never>;
  ftsBackfill: Record<string, never>;
  importKnowledge: { entries: any[] };
  importPlans: { plans: any[] };
  exportToFile: { include: string[]; version: string; exportedAt?: string };
  'curation.run': CurationJobOptions;
  'curation.resume': CurationJobOptions & { runId:string };
  'curation.apply': { actionId:string };
  'curation.reject': { actionId:string };
  'curation.undo': { actionId:string };
  'curation.purge': { autonomy:'off'|'suggest'|'auto-safe'|'auto'; retentionDays:number; batchSize?:number };
  'curation.activity': { lastSeenAt?:string|null };
};
export type JobResults = {
  health: { database: true; sqliteVec: true; threadId: number };
  'duplicates.pairs': { result: unknown[]; fingerprint: string };
  'duplicates.groups': { result: unknown[]; fingerprint: string };
  reembedAll: number;
  embedMissing: { embedded: number; failed: number; remaining: number; cancelled: boolean };
  hashBackfill: { changes: number };
  ftsBackfill: { changes: number };
  importKnowledge: { imported: number; skipped: number; errors: string[] };
  importPlans: { imported: number; skipped: number; errors: string[] };
  exportToFile: { path: string; bytes: number };
  'curation.run': import('../services/curation-types.js').CurationRunResult;
  'curation.resume': import('../services/curation-types.js').CurationRunResult;
  'curation.apply': { applied:boolean };
  'curation.reject': { rejected:true };
  'curation.undo': { actionId:string; status:'undone' };
  'curation.purge': { purged:number };
  'curation.activity': { updated:true };
};
export type JobProgress = {
  health: { phase: string; done: number; total: number };
  'duplicates.pairs': { phase: 'duplicates.pairs'; done: number; total: number };
  'duplicates.groups': { phase: 'duplicates.groups'; done: number; total: number };
  reembedAll: { phase: 'knowledge' | 'plans'; done: number; total: number };
  embedMissing: { phase: 'knowledge' | 'plans'; done: number; total: number; failed: number };
  hashBackfill: { phase: 'hashBackfill'; done: number; total: number };
  ftsBackfill: { phase: 'ftsBackfill'; done: number; total: number };
  importKnowledge: { phase: 'importKnowledge'; done: number; total: number };
  importPlans: { phase: 'importPlans'; done: number; total: number };
  exportToFile: { phase: 'exportToFile'; done: number; total: number };
  'curation.run': { phase:string; done:number; total:number; cursor:string };
  'curation.resume': { phase:string; done:number; total:number; cursor:string };
  'curation.apply': { phase:'curation.apply'; done:number; total:number };
  'curation.reject': { phase:'curation.reject'; done:number; total:number };
  'curation.undo': { phase:'curation.undo'; done:number; total:number };
  'curation.purge': { phase:'curation.purge'; done:number; total:number };
  'curation.activity': { phase:'curation.activity'; done:number; total:number };
};

export type ParentMessage =
  | { type: 'run'; id: string; kind: JobKind; payload: unknown }
  | { type: 'cancel'; id: string }
  | { type: 'continue'; id: string }
  | { type: 'shutdown' };
export type WorkerMessage =
  | { type: 'progress'; id: string; progress: unknown }
  | { type: 'done'; id: string; result: unknown }
  | { type: 'error'; id: string | null; error: { code: string; message: string } }
  | { type: 'closed' };
