export type JobKind = 'health' | 'duplicates.pairs' | 'duplicates.groups' | 'reembedAll' | 'embedMissing' | 'hashBackfill' | 'importKnowledge' | 'importPlans' | 'exportToFile';
export type DuplicateJobOptions = { threshold?: number; limit?: number };
export type JobPayloads = {
  health: Record<string, unknown>;
  'duplicates.pairs': DuplicateJobOptions;
  'duplicates.groups': DuplicateJobOptions;
  reembedAll: Record<string, never>;
  embedMissing: Record<string, never>;
  hashBackfill: Record<string, never>;
  importKnowledge: { entries: any[] };
  importPlans: { plans: any[] };
  exportToFile: { include: string[]; version: string; exportedAt?: string };
};
export type JobResults = {
  health: { database: true; sqliteVec: true; threadId: number };
  'duplicates.pairs': { result: unknown[]; fingerprint: string };
  'duplicates.groups': { result: unknown[]; fingerprint: string };
  reembedAll: number;
  embedMissing: { embedded: number; failed: number; remaining: number; cancelled: boolean };
  hashBackfill: { changes: number };
  importKnowledge: { imported: number; skipped: number; errors: string[] };
  importPlans: { imported: number; skipped: number; errors: string[] };
  exportToFile: { path: string; bytes: number };
};
export type JobProgress = {
  health: { phase: string; done: number; total: number };
  'duplicates.pairs': { phase: 'duplicates.pairs'; done: number; total: number };
  'duplicates.groups': { phase: 'duplicates.groups'; done: number; total: number };
  reembedAll: { phase: 'knowledge' | 'plans'; done: number; total: number };
  embedMissing: { phase: 'knowledge' | 'plans'; done: number; total: number; failed: number };
  hashBackfill: { phase: 'hashBackfill'; done: number; total: number };
  importKnowledge: { phase: 'importKnowledge'; done: number; total: number };
  importPlans: { phase: 'importPlans'; done: number; total: number };
  exportToFile: { phase: 'exportToFile'; done: number; total: number };
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
