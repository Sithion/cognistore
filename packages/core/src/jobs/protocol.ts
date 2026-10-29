export type JobKind = 'health' | 'duplicates.pairs' | 'duplicates.groups';
export type DuplicateJobOptions = { threshold?: number; limit?: number };
export type JobPayloads = {
  health: Record<string, unknown>;
  'duplicates.pairs': DuplicateJobOptions;
  'duplicates.groups': DuplicateJobOptions;
};
export type JobResults = {
  health: { database: true; sqliteVec: true; threadId: number };
  'duplicates.pairs': { result: unknown[]; fingerprint: string };
  'duplicates.groups': { result: unknown[]; fingerprint: string };
};
export type JobProgress = {
  health: { phase: string; done: number; total: number };
  'duplicates.pairs': { phase: 'duplicates.pairs'; done: number; total: number };
  'duplicates.groups': { phase: 'duplicates.groups'; done: number; total: number };
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
