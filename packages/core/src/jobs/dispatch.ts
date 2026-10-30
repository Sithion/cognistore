import { findDuplicateGroupsForJob, findDuplicatePairsForJob, duplicateFingerprint } from '../services/duplicate-scan.js';
import type { SQLiteDatabase } from '../db/client.js';
import type { KnowledgeService } from '../services/knowledge.service.js';
import type { JobKind, JobPayloads, JobProgress, JobResults } from './protocol.js';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

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
  if (kind === 'exportToFile') {
    const opts = payload as JobPayloads['exportToFile'];
    const dir = await mkdtemp(join(tmpdir(), 'cognistore-export-'));
    const path = join(dir, `${randomUUID()}.json`);
    let stream: ReturnType<typeof createWriteStream> | undefined;
    let snapshot = false;
    const onAbort = () => stream?.destroy();
    try {
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' });
      // This read transaction pins one WAL snapshot for consistent output; checkpoints cannot pass it while the export runs.
      sqlite.exec('BEGIN DEFERRED'); snapshot = true;
      const handle = await open(path, 'wx', 0o600);
      await handle.close();
      stream = createWriteStream(path, { flags: 'w', mode: 0o600 });
      let streamError: Error | undefined;
      stream.on('error', (e) => { streamError ??= e; });
      signal?.addEventListener('abort', onAbort, { once: true });
      let bytes = 0;
      const write = async (chunk: string) => {
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' });
        if (streamError) throw streamError;
        bytes += Buffer.byteLength(chunk);
        if (!stream!.write(chunk)) await once(stream!, 'drain');
        if (streamError) throw streamError;
      };
      const checkAbort = () => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' }); };
      await checkpoint?.({ phase: 'exportToFile', done: 0, total: 0 });
      checkAbort();
      await write(`{"version":${JSON.stringify(opts.version)},"exportedAt":${JSON.stringify(opts.exportedAt ?? new Date().toISOString())},`);
      let sectionCount = 0;
      const beginSection = async (key: string) => { if (sectionCount > 0) await write(','); sectionCount++; await write(`${JSON.stringify(key)}:[`); };
      if (opts.include.includes('knowledge')) {
        await beginSection('knowledge');
        let cursor: { created_at: string; id: string } | undefined;
        let first = true;
        const firstPage = sqlite.prepare(`SELECT id,title,content,tags,type,scope,source,confidence_score,agent_id,created_at,updated_at FROM knowledge_entries
          WHERE type != 'system' ORDER BY created_at DESC,id DESC LIMIT 250`);
        const cursorPage = sqlite.prepare(`SELECT id,title,content,tags,type,scope,source,confidence_score,agent_id,created_at,updated_at FROM knowledge_entries
          WHERE type != 'system' AND created_at <= ? AND (created_at < ? OR id < ?)
          ORDER BY created_at DESC,id DESC LIMIT 250`);
        while (true) {
          const rows = (cursor ? cursorPage.all(cursor.created_at, cursor.created_at, cursor.id) : firstPage.all()) as any[];
          if (!rows.length) break;
          cursor = { created_at: rows.at(-1).created_at, id: rows.at(-1).id };
          for (const row of rows) {
            if (!first) await write(','); first = false;
            await write(JSON.stringify({ title: row.title, content: row.content, tags: JSON.parse(row.tags), type: row.type,
              scope: row.scope, source: row.source, confidenceScore: row.confidence_score, agentId: row.agent_id,
              createdAt: isoDate(row.created_at), updatedAt: isoDate(row.updated_at) }));
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
          checkAbort();
        }
        await write(']');
      }
      if (opts.include.includes('plans')) {
        await beginSection('plans');
        let cursor: { created_at: string; id: string } | undefined;
        let first = true;
        const firstPage = sqlite.prepare(`SELECT id,title,content,tags,scope,source,status,created_at FROM plans
          ORDER BY created_at DESC,id DESC LIMIT 250`);
        const cursorPage = sqlite.prepare(`SELECT id,title,content,tags,scope,source,status,created_at FROM plans
          WHERE created_at <= ? AND (created_at < ? OR id < ?)
          ORDER BY created_at DESC,id DESC LIMIT 250`);
        while (true) {
          const plans = (cursor ? cursorPage.all(cursor.created_at, cursor.created_at, cursor.id) : firstPage.all()) as any[];
          if (!plans.length) break;
          cursor = { created_at: plans.at(-1).created_at, id: plans.at(-1).id };
          const ids = plans.map((p) => p.id);
          const marks = ids.map(() => '?').join(',');
          const tasks = sqlite.prepare(`SELECT plan_id,description,status,priority,notes,position FROM plan_tasks WHERE plan_id IN (${marks}) ORDER BY plan_id,position`).all(...ids) as any[];
          const tasksByPlan = new Map<string, any[]>();
          for (const task of tasks) { const list = tasksByPlan.get(task.plan_id) ?? []; list.push(task); tasksByPlan.set(task.plan_id, list); }
          for (const plan of plans) {
            if (!first) await write(','); first = false;
            await write(JSON.stringify({ title: plan.title, content: plan.content, tags: JSON.parse(plan.tags), scope: plan.scope,
              source: plan.source, status: plan.status, createdAt: isoDate(plan.created_at),
              tasks: (tasksByPlan.get(plan.id) ?? []).map(({ description, status, priority, notes, position }) => ({ description, status, priority, notes, position })) }));
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
          checkAbort();
        }
        await write(']');
      }
      await write('}');
      stream.end();
      await once(stream, 'finish');
      if (streamError) throw streamError;
      sqlite.exec('COMMIT'); snapshot = false;
      signal?.removeEventListener('abort', onAbort);
      return { path, bytes } as JobResults[K];
    } catch (error) {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (snapshot) { try { sqlite.exec('ROLLBACK'); } catch { /* connection closed */ } }
      stream?.destroy();
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
  throw new Error(`Unknown job kind: ${String(kind)}`);
}

function isoDate(value: unknown): unknown {
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
