import { parentPort, workerData } from 'node:worker_threads';
import { dispatchJobWithConnection, createDbClient, KnowledgeRepository, KnowledgeService } from '@cognistore/core';
import type { JobKind, JobPayloads, JobProgress, ParentMessage, WorkerMessage } from '@cognistore/core';
import { OllamaEmbeddingClient } from '@cognistore/embeddings';

if (!parentPort) throw new Error('Worker requires a parent port');
type JobProgressUpdate = JobProgress[JobKind];
let active: { id: string; cancelled: boolean; controller: AbortController; checkpoint?: () => void } | undefined;
let closing = false;
let sqlite: ReturnType<typeof createDbClient>['sqlite'];
let service: KnowledgeService;
try {
  const connection = createDbClient(workerData.databasePath);
  sqlite = connection.sqlite;
  const ollama = new OllamaEmbeddingClient(workerData.embeddingConfig);
  service = new KnowledgeService(new KnowledgeRepository(connection.db, sqlite), ollama);
} catch (error) {
  const e = error as Error & { code?: string };
  parentPort.postMessage({ type: 'error', id: null, error: { code: e.code ?? 'WORKER_STARTUP_ERROR', message: e.message } });
  parentPort.close();
}
parentPort.on('message', async (message: ParentMessage) => {
  if (message.type === 'shutdown') {
    if (closing) return;
    closing = true;
    const current = active;
    if (current) { current.cancelled = true; current.controller.abort(); current.checkpoint?.(); }
    service?.flushPendingWrites();
    service?.stopPendingWriteTimers();
    sqlite?.close();
    parentPort!.postMessage({ type: 'closed' });
    parentPort!.close();
    return;
  }
  const current = active;
  if (message.type === 'cancel' && current && current.id === message.id) { current.cancelled = true; current.controller.abort(); current.checkpoint?.(); return; }
  if (message.type === 'continue' && current && current.id === message.id) { current.checkpoint?.(); return; }
  if (message.type !== 'run') return;
  const job: { id: string; cancelled: boolean; controller: AbortController; checkpoint?: () => void } = {
    id: message.id,
    cancelled: false,
    controller: new AbortController(),
  };
  active = job;
  try {
    const checkpoint = () => new Promise<void>((resolve, reject) => {
      job.checkpoint = () => { job.checkpoint = undefined; job.cancelled ? reject(Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' })) : resolve(); };
    });
    if (message.kind === 'health') {
      const progress: JobProgressUpdate = { phase: 'health', done: 0, total: 1 };
      parentPort!.postMessage({ type: 'progress', id: job.id, progress } satisfies WorkerMessage);
      await checkpoint();
    }
    const activeJob = job;
    const reportProgress = async (progress: JobProgressUpdate) => {
      if (job.cancelled) throw Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' });
      parentPort!.postMessage({ type: 'progress', id: job.id, progress } satisfies WorkerMessage);
      await checkpoint();
    };
    const result = await dispatchJobWithConnection(
      message.kind,
      message.payload as JobPayloads[typeof message.kind],
      sqlite,
      reportProgress,
      service,
      job.controller.signal,
    );
    parentPort!.postMessage({ type: 'done', id: activeJob.id, result } satisfies WorkerMessage);
  } catch (error) {
    const e = error as Error & { code?: string };
    parentPort!.postMessage({ type: 'error', id: job.id, error: { code: e.code ?? 'JOB_ERROR', message: e.message } } satisfies WorkerMessage);
  } finally { if (active === job) active = undefined; }
});
