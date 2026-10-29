export type JobKind = 'health';
export type JobPayloads = { health: Record<string, unknown> };
export type JobResults = { health: { database: true; sqliteVec: true; threadId: number } };
export type JobProgress = { health: { phase: string; done: number; total: number } };

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
