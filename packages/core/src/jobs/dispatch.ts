import { findDuplicateGroupsForJob, findDuplicatePairsForJob, duplicateFingerprint } from '../services/duplicate-scan.js';
import type { SQLiteDatabase } from '../db/client.js';
import type { KnowledgeService } from '../services/knowledge.service.js';
import type { JobKind, JobPayloads, JobProgress, JobResults } from './protocol.js';

type JobProgressUpdate = JobProgress[JobKind];

export async function dispatchJobWithConnection<K extends JobKind>(kind: K, payload: JobPayloads[K], sqlite: SQLiteDatabase, checkpoint?: (progress: JobProgressUpdate) => Promise<void>, service?: KnowledgeService, signal?: AbortSignal): Promise<JobResults[K]> {
  if (kind === 'duplicates.pairs' || kind === 'duplicates.groups') {
    const opts = payload as JobPayloads['duplicates.pairs'];
    const capturedFingerprint = duplicateFingerprint(sqlite, opts.threshold ?? 0.9);
    const result = kind === 'duplicates.pairs'
      ? await findDuplicatePairsForJob(sqlite, opts, async (done, total) => checkpoint?.({ phase: 'duplicates.pairs', done, total }))
      : await findDuplicateGroupsForJob(sqlite, opts, async (done, total) => checkpoint?.({ phase: 'duplicates.groups', done, total }));
    return { result, fingerprint: capturedFingerprint } as JobResults[K];
  }
  if (kind === 'health') {
    sqlite.prepare('SELECT 1').get();
    sqlite.prepare('SELECT vec_version()').get();
    const { threadId } = await import('node:worker_threads');
    return { database: true, sqliteVec: true, threadId } as JobResults[K];
  }
  if (kind === 'reembedAll') {
    if (!service) throw new Error('Embedding service unavailable');
    return (await service.reembedAll({ signal, checkpoint: async (phase, done, total) => checkpoint?.({ phase, done, total }) })) as JobResults[K];
  }
  if (kind === 'embedMissing') {
    if (!service) throw new Error('Embedding service unavailable');
    let lastCheckpoint = Date.now();
    return (await service.embedMissing({
      signal,
      workerProgress: async (progress) => {
        const boundary = progress.done === 0 || progress.done === progress.total;
        if (!boundary && Date.now() - lastCheckpoint < 50) return;
        lastCheckpoint = Date.now();
        await checkpoint?.({ ...progress });
      },
    })) as JobResults[K];
  }
  if (kind === 'hashBackfill') {
    if (!service) throw new Error('Knowledge service unavailable');
    const result = await service.hashBackfill({ signal, checkpoint: async (done, total) => {
      await checkpoint?.({ phase: 'hashBackfill', done, total });
    } });
    await checkpoint?.({ phase: 'hashBackfill', done: result.changes, total: result.changes });
    return result as JobResults[K];
  }
  if (kind === 'importKnowledge') {
    if (!service) throw new Error('Knowledge service unavailable');
    const entries = (payload as JobPayloads['importKnowledge']).entries;
    let lastCheckpoint = Date.now();
    const result = await service.importKnowledge(entries, { signal, checkpoint: async (done, total) => {
      if (done !== 0 && done !== total && Date.now() - lastCheckpoint < 50) return;
      lastCheckpoint = Date.now();
      await checkpoint?.({ phase: 'importKnowledge', done, total });
    } });
    await checkpoint?.({ phase: 'importKnowledge', done: entries.length, total: entries.length });
    return result as JobResults[K];
  }
  if (kind === 'importPlans') {
    if (!service) throw new Error('Knowledge service unavailable');
    const plans = (payload as JobPayloads['importPlans']).plans;
    let lastCheckpoint = Date.now();
    const result = await service.importPlans(plans, { signal, checkpoint: async (done, total) => {
      if (done !== 0 && done !== total && Date.now() - lastCheckpoint < 50) return;
      lastCheckpoint = Date.now();
      await checkpoint?.({ phase: 'importPlans', done, total });
    } });
    await checkpoint?.({ phase: 'importPlans', done: plans.length, total: plans.length });
    return result as JobResults[K];
  }
  throw new Error(`Unknown job kind: ${String(kind)}`);
}
