import { parentPort, workerData, threadId } from 'node:worker_threads';
import { dispatchJobWithConnection, createDbClient, KnowledgeRepository, KnowledgeService } from '@cognistore/core';
import { OllamaEmbeddingClient } from '@cognistore/embeddings';
import { performance } from 'node:perf_hooks';

if (!parentPort) throw new Error('Worker requires a parent port');
let active: { id: string; cancelled: boolean; checkpoint?: () => void } | undefined;
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
parentPort.on('message', async (message: any) => {
  if (message.type === 'shutdown') {
    if (closing) return;
    closing = true;
    const current = active;
    if (current) { current.cancelled = true; current.checkpoint?.(); }
    service?.flushPendingWrites();
    service?.stopPendingWriteTimers();
    sqlite?.close();
    parentPort!.postMessage({ type: 'closed' });
    parentPort!.close();
    return;
  }
  const current = active;
  if (message.type === 'cancel' && current && current.id === message.id) { current.cancelled = true; current.checkpoint?.(); return; }
  if (message.type === 'continue' && current && current.id === message.id) { current.checkpoint?.(); return; }
  if (message.type !== 'run') return;
  const job: { id: string; cancelled: boolean; checkpoint?: () => void } = { id: message.id, cancelled: false };
  active = job;
  try {
    const checkpoint = () => new Promise<void>((resolve, reject) => {
      job.checkpoint = () => { job.checkpoint = undefined; job.cancelled ? reject(Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' })) : resolve(); };
    });
    if (message.kind === 'health') {
      parentPort!.postMessage({ type: 'progress', id: job.id, progress: { phase: 'health', done: 0, total: 1 } });
      await checkpoint();
    }
    const activeJob = job;
    let lastProgress = performance.now();
    const result = await dispatchJobWithConnection(message.kind, message.payload, sqlite, async (done, total) => {
      if (job.cancelled) throw Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' });
      if (performance.now() - lastProgress < 50) return;
      lastProgress = performance.now();
      parentPort!.postMessage({ type: 'progress', id: job.id, progress: { phase: message.kind, done, total } });
      await checkpoint();
    });
    parentPort!.postMessage({ type: 'done', id: activeJob.id, result: { ...result, threadId } });
  } catch (error) {
    const e = error as Error & { code?: string };
    parentPort!.postMessage({ type: 'error', id: job.id, error: { code: e.code ?? 'JOB_ERROR', message: e.message } });
  } finally { if (active === job) active = undefined; }
});
