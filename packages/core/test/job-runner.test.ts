import { afterEach, expect, it } from 'vitest';
import { makeDb } from './helpers.js';
import { JobRunner } from '../src/jobs/runner.js';

let ctx: ReturnType<typeof makeDb> | undefined;
let runner: JobRunner | undefined;
afterEach(async () => { await runner?.close(); ctx?.cleanup(); runner = undefined; ctx = undefined; });
function setup() {
  ctx = makeDb();
  runner = new JobRunner({ workerUrl: new URL('./fixtures/job-worker.mjs', import.meta.url), databasePath: ctx.sqlite.name, embeddingConfig: { host: 'http://127.0.0.1:1', model: 'fixed', dimensions: 256 } });
  return runner;
}
it('keeps one active job, FIFO order and correlated progress on a nonzero thread', async () => {
  const r = setup(); const order: number[] = []; const progress: number[] = [];
  await Promise.all([1, 2, 3].map((n) => r.run<any>('health', { n }, { onProgress: () => { progress.push(n); } }).then((value) => { expect(value.threadId).toBeGreaterThan(0); order.push(value.n); })));
  expect(progress).toEqual([1, 2, 3]); expect(order).toEqual([1, 2, 3]);
});
it('cancels queued work without progress and cancels active work at a barrier', async () => {
  const r = setup(); const first = new AbortController(); const queued = new AbortController(); let queuedRan = false;
  const a = r.run('health', { n: 1 }, { signal: first.signal, onProgress: () => first.abort() });
  const b = r.run('health', { n: 2 }, { signal: queued.signal, onProgress: () => { queuedRan = true; } }); queued.abort();
  const results = await Promise.allSettled([a, b]); expect(results.map((x) => x.status)).toEqual(['rejected', 'rejected']); expect(queuedRan).toBe(false);
});
it('rejects active and queued jobs after unexpected exit', async () => {
  const r = setup(); const results = await Promise.allSettled([r.run('health', { crash: true }), r.run('health', { n: 2 })]);
  expect(results.map((x) => x.status)).toEqual(['rejected', 'rejected']);
});
it('closes active work and rejects future calls', async () => {
  const r = setup(); let closing: Promise<void> | undefined;
  const active = r.run('health', { n: 1 }, { onProgress: () => { closing = r.close(); } });
  expect((await Promise.allSettled([active]))[0].status).toBe('rejected'); await closing; await expect(r.run('health', {})).rejects.toThrow();
});

it('rejects pending startup when worker posts a null-id error and exits successfully', async () => {
  ctx = makeDb();
  runner = new JobRunner({ workerUrl: new URL('./fixtures/startup-error-worker.mjs', import.meta.url), databasePath: ctx.sqlite.name, embeddingConfig: { host: 'http://127.0.0.1:1', model: 'fixed', dimensions: 256 } });
  await expect(runner.run('health', {})).rejects.toMatchObject({ code: 'WORKER_STARTUP_ERROR', message: 'fixture startup failure' });
}, 5000);

it('rejects a mid-job exit and runs the next job in a new worker', async () => {
  const r = setup();
  await expect(r.run('health', { exitOne: true })).rejects.toThrow('exited with code 1');
  expect((await r.run<any>('health', { n: 2 })).threadId).toBeGreaterThan(0);
});

it('rejects runs after three consecutive startup failures', async () => {
  ctx = makeDb();
  runner = new JobRunner({ workerUrl: new URL('./fixtures/startup-error-worker.mjs', import.meta.url), databasePath: ctx.sqlite.name, embeddingConfig: { host: 'http://127.0.0.1:1', model: 'fixed', dimensions: 256 } });
  for (let i = 0; i < 3; i++) await expect(runner.run('health', {})).rejects.toMatchObject({ code: 'WORKER_STARTUP_ERROR' });
  await expect(runner.run('health', {})).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' });
});

it('rejects the 33rd queued job', async () => {
  const r = setup();
  const jobs = [r.run('health', { n: 1 })];
  for (let i = 0; i < 32; i++) jobs.push(r.run('health', { n: i + 2 }));
  await expect(r.run('health', {})).rejects.toMatchObject({ code: 'QUEUE_FULL' });
  await Promise.all(jobs);
});

it('closes an idle worker promptly', async () => {
  const r = setup();
  await r.run('health', {});
  const started = Date.now();
  await r.close();
  expect(Date.now() - started).toBeLessThan(500);
});
