import type { JobKind, JobPayloads, JobResults } from './protocol.js';

export async function dispatchJobWithConnection<K extends JobKind>(kind: K, _payload: JobPayloads[K], sqlite: { prepare(sql: string): { get(): unknown } }): Promise<JobResults[K]> {
  if (kind !== 'health') throw new Error(`Unknown job kind: ${String(kind)}`);
  sqlite.prepare('SELECT 1').get();
  sqlite.prepare('SELECT vec_version()').get();
  const { threadId } = await import('node:worker_threads');
  return { database: true, sqliteVec: true, threadId } as JobResults[K];
}
