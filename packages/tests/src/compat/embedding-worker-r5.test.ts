import { test, expect } from '@playwright/test';
import { fixture, seed, forbidMain, deferred } from '../r5-worker-helpers.js';

test('missing repair preserves failed progress and cancellation, then resumes', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    seed(f.sqlite, 2);
    f.sqlite.prepare("UPDATE knowledge_entries SET title='FAIL',type='system' WHERE id='id-00001'").run();
    f.mock.setHook(async (prompt) => { if (prompt.includes('FAIL')) throw new Error('fixed'); });
    restore = forbidMain(['embedMissing', 'reembedAll']);
    const progress: unknown[] = [];
    expect(await f.sdk.embedMissing({ onProgress: (p) => progress.push(p) }))
      .toEqual({ embedded: 1, failed: 1, remaining: 1, cancelled: false });
    expect(progress).toEqual([
      { phase: 'knowledge', done: 0, total: 2, failed: 0 },
      { phase: 'knowledge', done: 2, total: 2, failed: 1 },
      { phase: 'plans', done: 0, total: 0, failed: 1 },
    ]);
    f.mock.setHook();
    const resumed: unknown[] = [];
    expect(await f.sdk.embedMissing({ onProgress: (p) => resumed.push(p) }))
      .toEqual({ embedded: 1, failed: 0, remaining: 0, cancelled: false });
    expect(resumed).toEqual([
      { phase: 'knowledge', done: 0, total: 1, failed: 0 },
      { phase: 'knowledge', done: 1, total: 1, failed: 0 },
      { phase: 'plans', done: 0, total: 0, failed: 0 },
    ]);
    f.sqlite.exec('DELETE FROM knowledge_embeddings');
    f.mock.setHook(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    const controller = new AbortController();
    const cancelled: unknown[] = [];
    await expect(f.sdk.embedMissing({
      signal: controller.signal,
      onProgress: (p) => { cancelled.push(p); if (p.done > 0) controller.abort(); },
    })).resolves.toMatchObject({ embedded: 1, cancelled: true });
    expect(cancelled).toEqual([
      { phase: 'knowledge', done: 0, total: 2, failed: 0 },
      { phase: 'knowledge', done: 1, total: 2, failed: 0 },
    ]);
  } finally { restore(); await f.close(); }
});

test('does not publish an embedding after an intervening edit or delete', async () => {
  for (const action of ['edit', 'delete']) {
    const f = await fixture();
    let restore = () => {};
    const entered = deferred();
    const release = deferred();
    try {
      seed(f.sqlite, 1);
      f.mock.setHook(async () => { entered.resolve(); await release.promise; });
      restore = forbidMain(['embedMissing']);
      const job = f.sdk.embedMissing();
      await entered.promise;
      if (action === 'edit') {
        f.sqlite.prepare("UPDATE knowledge_entries SET content='changed',updated_at='2026-10-02T00:00:00Z' WHERE id='id-00000'").run();
      } else {
        f.sqlite.prepare("DELETE FROM knowledge_entries WHERE id='id-00000'").run();
      }
      release.resolve();
      const result = await job;
      expect(result.embedded).toBe(0);
      expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_embeddings').get()).toEqual({ n: 0 });
    } finally { release.resolve(); restore(); await f.close(); }
  }
});

test('reembed covers knowledge and plans through the worker', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    seed(f.sqlite, 1);
    f.sqlite.exec(`INSERT INTO plans(id,title,content,tags,scope,status,source,created_at,updated_at)
      VALUES('plan-fixed','Plan','fixed','[]','global','draft','r5','2026-10-01','2026-10-01')`);
    restore = forbidMain(['reembedAll']);
    expect(await f.sdk.reembedAll()).toBe(2);
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_embeddings').get()).toEqual({ n: 1 });
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM plans_embeddings').get()).toEqual({ n: 1 });
  } finally { restore(); await f.close(); }
});

test('runner can be recreated after close and still runs embedding jobs', async () => {
  const f = await fixture();
  try {
    seed(f.sqlite, 1);
    await f.sdk.findDuplicateGroups();
    await f.sdk.close();
    await f.sdk.initialize();
    expect(await f.sdk.reembedAll()).toBe(1);
    f.sqlite.exec('DELETE FROM knowledge_embeddings');
    expect(await f.sdk.embedMissing()).toMatchObject({ embedded: 1, failed: 0, remaining: 0, cancelled: false });
  } finally { await f.close(); }
});
