import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { JobKind, JobPayloads, JobResults, WorkerMessage } from './protocol.js';

type Options = { signal?: AbortSignal; onProgress?: (progress: unknown) => void | Promise<void> };
type Entry = { id: string; kind: JobKind; payload: unknown; options: Options; resolve: (v: unknown) => void; reject: (e: Error) => void; abort?: () => void };
export type JobRunnerConfig = { workerUrl: URL; databasePath: string; embeddingConfig: { host: string; model: string; dimensions: number } };

function abortError(message = 'The operation was aborted'): Error {
  const e = new Error(message); e.name = 'AbortError'; return e;
}

export class JobRunner {
  private static readonly maxQueueSize = 32;
  private worker?: Worker;
  private queue: Entry[] = [];
  private active?: Entry;
  private closed = false;
  private closing?: Promise<void>;
  private startupFailures = 0;
  private startupFailureWorkers = new WeakSet<Worker>();
  constructor(private readonly config: JobRunnerConfig) {}

  run<K extends JobKind>(kind: K, payload: JobPayloads[K], options: Options = {}): Promise<JobResults[K]> {
    if (this.closed) return Promise.reject(new Error('JobRunner is closed'));
    if (this.startupFailures >= 3) return Promise.reject(Object.assign(new Error('Worker unavailable after repeated startup failures'), { code: 'WORKER_UNAVAILABLE' }));
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (this.queue.length >= JobRunner.maxQueueSize) return Promise.reject(Object.assign(new Error('Job queue is full'), { code: 'QUEUE_FULL' }));
    return new Promise<JobResults[K]>((resolve, reject) => {
      const entry: Entry = { id: randomUUID(), kind, payload, options, resolve: (v) => resolve(v as JobResults[K]), reject };
      entry.abort = () => {
        if (this.active === entry) this.worker?.postMessage({ type: 'cancel', id: entry.id });
        else { const i = this.queue.indexOf(entry); if (i >= 0) { this.queue.splice(i, 1); reject(abortError()); } }
      };
      options.signal?.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const e of this.queue.splice(0)) { e.options.signal?.removeEventListener('abort', e.abort!); e.reject(abortError('JobRunner closed')); }
    this.closing = (async () => {
      const worker = this.worker;
      if (!worker) return;
      let closed = false; let exited = false;
      const closedPromise = new Promise<void>((resolve) => {
        const check = () => { if (closed && exited) resolve(); };
        worker.on('message', (m: WorkerMessage) => { if (m.type === 'closed') { closed = true; check(); } });
        worker.once('exit', () => { exited = true; check(); });
      });
      if (this.active) worker.postMessage({ type: 'cancel', id: this.active.id });
      worker.postMessage({ type: 'shutdown' });
      let timerHandle: ReturnType<typeof setTimeout>;
      const timer = new Promise<void>((resolve) => { timerHandle = setTimeout(resolve, 5000); timerHandle.unref?.(); });
      await Promise.race([closedPromise, timer]);
      clearTimeout(timerHandle!);
      if (!exited) await worker.terminate();
      if (this.active) {
        const entry = this.active; this.active = undefined;
        entry.options.signal?.removeEventListener('abort', entry.abort!);
        entry.reject(abortError('JobRunner closed'));
      }
      this.worker = undefined;
    })();
    return this.closing;
  }

  private pump(): void {
    if (this.closed || this.active || !this.queue.length) return;
    const entry = this.queue.shift()!;
    this.active = entry;
    if (!this.worker) {
      const worker = new Worker(this.config.workerUrl, { workerData: { databasePath: this.config.databasePath, embeddingConfig: this.config.embeddingConfig } });
      this.worker = worker;
      worker.unref();
      worker.on('message', (m: WorkerMessage) => void this.message(m));
      worker.on('error', (e) => this.failAll(e instanceof Error ? e : new Error(String(e))));
      worker.on('exit', (code) => { if (!this.closed) this.failAll(new Error(`Job worker exited with code ${code}`)); });
    }
    this.worker.ref();
    this.worker.postMessage({ type: 'run', id: entry.id, kind: entry.kind, payload: entry.payload });
  }

  private async message(m: WorkerMessage): Promise<void> {
    if (m.type === 'error' && m.id === null) {
      if (this.worker && !this.startupFailureWorkers.has(this.worker)) {
        this.startupFailureWorkers.add(this.worker);
        this.startupFailures++;
      }
      this.failAll(Object.assign(new Error(m.error.message), { code: m.error.code }));
      return;
    }
    const e = this.active;
    if (!e || !('id' in m) || m.id !== e.id) return;
    if (m.type === 'progress') {
      try {
        await e.options.onProgress?.(m.progress);
        if (e.options.signal?.aborted) this.worker?.postMessage({ type: 'cancel', id: e.id });
        else this.worker?.postMessage({ type: 'continue', id: e.id });
      } catch { this.worker?.postMessage({ type: 'cancel', id: e.id }); }
      return;
    }
    if (m.type === 'done') { this.startupFailures = 0; this.finish(e); e.resolve(m.result); }
    else if (m.type === 'error') { this.finish(e); const err = m.error.code === 'ABORT_ERR' ? abortError(m.error.message) : Object.assign(new Error(m.error.message), { code: m.error.code }); e.reject(err); }
  }
  private finish(e: Entry): void { e.options.signal?.removeEventListener('abort', e.abort!); this.active = undefined; this.worker?.unref(); this.pump(); }
  private failAll(error: Error): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.removeAllListeners();
      void worker.terminate();
    }
    if (this.active) { this.active.options.signal?.removeEventListener('abort', this.active.abort!); this.active.reject(error); this.active = undefined; }
    for (const e of this.queue.splice(0)) { e.options.signal?.removeEventListener('abort', e.abort!); e.reject(error); }
  }
}
