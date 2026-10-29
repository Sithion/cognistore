import { findDuplicateGroupsForJob, findDuplicatePairsForJob, duplicateFingerprint } from '../services/duplicate-scan.js';
import type { SQLiteDatabase } from '../db/client.js';
import type { JobKind, JobPayloads, JobResults } from './protocol.js';

export async function dispatchJobWithConnection<K extends JobKind>(kind: K, payload: JobPayloads[K], sqlite: SQLiteDatabase, checkpoint?: (done: number, total: number) => Promise<void>): Promise<JobResults[K]> {
  if (kind === 'duplicates.pairs' || kind === 'duplicates.groups') {
    const opts = payload as JobPayloads['duplicates.pairs'];
    const capturedFingerprint = duplicateFingerprint(sqlite, opts.threshold ?? 0.9);
    const result = kind === 'duplicates.pairs'
      ? await findDuplicatePairsForJob(sqlite, opts, checkpoint)
      : await findDuplicateGroupsForJob(sqlite, opts, checkpoint);
    return { result, fingerprint: capturedFingerprint } as JobResults[K];
  }
  if (kind === 'health') {
    sqlite.prepare('SELECT 1').get();
    sqlite.prepare('SELECT vec_version()').get();
    const { threadId } = await import('node:worker_threads');
    return { database: true, sqliteVec: true, threadId } as JobResults[K];
  }
  throw new Error(`Unknown job kind: ${String(kind)}`);
}
