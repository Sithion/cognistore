import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { dispatchJobWithConnection } from '../src/jobs/dispatch.js';
import { KnowledgeService } from '../src/services/knowledge.service.js';
import { makeDb, stubEmbedding } from './helpers.js';

describe('embedding batch repository methods', () => {
  let ctx: ReturnType<typeof makeDb>;
  beforeEach(() => { ctx = makeDb(); });
  afterEach(() => ctx.cleanup());

  it('publishes only rows whose source timestamps still match, including empty batches', async () => {
    const entry = await ctx.repository.create({ title: 'Entry', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', embedding: stubEmbedding('old') });
    const plan = ctx.repository.createPlan({ title: 'Plan', content: 'body', tags: [], scope: 'global', source: 'test', embedding: stubEmbedding('old') });
    const entryRow = ctx.repository.getKnowledgeEntryForEmbedding(entry.id)!;
    const planRow = ctx.repository.getPlanForEmbedding(plan.id)!;
    expect(ctx.repository.publishKnowledgeEmbeddingBatch([])).toBe(0);
    expect(ctx.repository.publishPlanEmbeddingBatch([])).toBe(0);
    expect(ctx.repository.publishKnowledgeEmbeddingBatch([
      { id: entry.id, updatedAt: entryRow.updatedAt, embedding: stubEmbedding('fresh') },
      { id: entry.id, updatedAt: 'stale', embedding: stubEmbedding('stale') },
    ])).toBe(1);
    expect(ctx.repository.publishPlanEmbeddingBatch([
      { id: plan.id, updatedAt: planRow.updatedAt, embedding: stubEmbedding('fresh plan') },
      { id: plan.id, updatedAt: 'stale', embedding: stubEmbedding('stale') },
    ])).toBe(1);
  });
});

describe('embedding job service', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => { ctx?.service.stopPendingWriteTimers(); ctx?.cleanup(); vi.restoreAllMocks(); });

  it('re-embeds knowledge and plans in batches, skips stale rows and reports boundaries', async () => {
    ctx = makeDb();
    const first = await ctx.service.add({ title: 'First', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', skipDedup: true });
    await ctx.service.createPlan({ title: 'Plan', content: 'body', tags: [], scope: 'global', source: 'test', skipDedup: true });
    const checkpoints: Array<[string, number, number]> = [];
    const original = ctx.repository.getKnowledgeEntryForEmbedding.bind(ctx.repository);
    vi.spyOn(ctx.repository, 'getKnowledgeEntryForEmbedding').mockImplementation((id) => {
      const row = original(id);
      if (id === first.id && row) return { ...row, updatedAt: 'stale' };
      return row;
    });
    expect(await ctx.service.reembedAll({ checkpoint: async (...args) => { checkpoints.push(args); } })).toBe(1);
    expect(checkpoints).toEqual(expect.arrayContaining([['knowledge', 0, 1], ['plans', 0, 1], ['plans', 1, 1]]));
  });

  it('flushes a ready re-embed batch before reporting ABORT_ERR', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add({ title: 'Abort after embed', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', skipDedup: true });
    const controller = new AbortController();
    const provider = new KnowledgeService(ctx.repository, { async embed() { controller.abort(); return stubEmbedding('ready'); } });
    await expect(provider.reembedAll({ signal: controller.signal })).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM knowledge_embeddings WHERE id=?').get(entry.id)).toEqual({ n: 1 });
  });

  it('counts failed publish batches and surfaces duplicate invalidation failures', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add({ title: 'Publish fail', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', skipDedup: true });
    vi.spyOn(ctx.repository, 'publishKnowledgeEmbeddingBatch').mockImplementation(() => { throw Object.assign(new Error('locked'), { code: 'SQLITE_LOCKED' }); });
    const service = new KnowledgeService(ctx.repository, { async embed() { return stubEmbedding('publish'); } });
    expect(await service.reembedAll()).toBe(0);
    expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM knowledge_embeddings WHERE id=?').get(entry.id)).toEqual({ n: 1 });

    vi.restoreAllMocks();
    const invalidate = vi.spyOn(ctx.repository, 'invalidateDuplicateScan').mockImplementation(() => { throw new Error('invalidation failed'); });
    const ok = new KnowledgeService(ctx.repository, { async embed() { return stubEmbedding('new'); } });
    await expect(ok.reembedAll()).rejects.toThrow('invalidation failed');
    expect(invalidate).toHaveBeenCalled();
  });

  it('retries bounded SQLITE_BUSY writes and reports embedding failures and progress boundaries', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add({ title: 'Retry me', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', skipDedup: true });
    const missingId = entry.id;
    const row = ctx.repository.getKnowledgeEntryForEmbedding(missingId)!;
    ctx.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(missingId);
    const publish = ctx.repository.publishKnowledgeEmbeddingBatch.bind(ctx.repository);
    let attempts = 0;
    vi.spyOn(ctx.repository, 'publishKnowledgeEmbeddingBatch').mockImplementation((...args) => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
      return publish(...args);
    });
    const progress: Array<{ phase: string; done: number; total: number; failed: number }> = [];
    const result = await ctx.service.embedMissing({ workerProgress: async (p) => { progress.push(p); } });
    expect(result).toEqual({ embedded: 1, failed: 0, remaining: 0, cancelled: false });
    expect(attempts).toBe(3);
    expect(progress).toEqual(expect.arrayContaining([
      { phase: 'knowledge', done: 0, total: 1, failed: 0 },
      { phase: 'knowledge', done: 1, total: 1, failed: 0 },
    ]));
    expect(row.id).toBe(missingId);
  });

  it('retries a real competing BEGIN IMMEDIATE connection and SQLITE_BUSY_SNAPSHOT', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add({ title: 'Lock retry', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', skipDedup: true });
    ctx.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(entry.id);
    const blocker = new BetterSqlite3(ctx.path);
    blocker.pragma('busy_timeout = 0');
    ctx.sqlite.pragma('busy_timeout = 50');
    blocker.exec('BEGIN IMMEDIATE');
    const release = setTimeout(() => { try { blocker.exec('COMMIT'); } catch {} }, 80);
    try {
      const job = ctx.service.embedMissing();
      expect(await job).toMatchObject({ embedded: 1, remaining: 0 });
    }
    finally { clearTimeout(release); try { blocker.exec('ROLLBACK'); } catch {} blocker.close(); }

    const publish = ctx.repository.publishKnowledgeEmbeddingBatch.bind(ctx.repository);
    let attempts = 0;
    vi.spyOn(ctx.repository, 'publishKnowledgeEmbeddingBatch').mockImplementation((rows) => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('snapshot'), { code: 'SQLITE_BUSY_SNAPSHOT' });
      return publish(rows);
    });
    ctx.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(entry.id);
    expect(await ctx.service.embedMissing()).toMatchObject({ embedded: 1, remaining: 0 });
    expect(attempts).toBe(2);
  }, 15000);

  it('counts embedding failures, keeps them resumable, and stops when cancelled', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add({ title: 'Fails', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', skipDedup: true });
    const id = entry.id;
    ctx.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = new KnowledgeService(ctx.repository, { async embed() { throw new Error('provider down'); } });
    const events: Array<{ done: number; total: number }> = [];
    expect(await failing.embedMissing({ onProgress: (p) => events.push(p) })).toEqual({ embedded: 0, failed: 1, remaining: 1, cancelled: false });
    expect(warn).toHaveBeenCalled();
    expect(events[0]).toMatchObject({ done: 0, total: 1 });
    expect(events.find((p) => p.phase === 'knowledge' && p.done === p.total && p.failed === 1)).toBeDefined();

    const controller = new AbortController();
    const cancelling = new KnowledgeService(ctx.repository, { async embed() { controller.abort(); return stubEmbedding('cancel'); } });
    expect(await cancelling.embedMissing({ signal: controller.signal })).toEqual({ embedded: 1, failed: 0, remaining: 0, cancelled: true });
  });
});

describe('embedding job dispatch', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => { ctx?.service.stopPendingWriteTimers(); ctx?.cleanup(); });

  it('dispatches both re-embedding kinds and always forwards embedMissing start and finish', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add({ title: 'Missing vector', content: 'body', tags: [], type: 'fact', scope: 'global', source: 'test', skipDedup: true });
    const id = entry.id;
    ctx.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(id);
    const progress: Array<{ phase: string; done: number; total: number }> = [];
    const checkpoint = async (p: any) => { progress.push(p); };
    expect(await dispatchJobWithConnection('embedMissing', {}, ctx.sqlite, checkpoint, ctx.service)).toMatchObject({ embedded: 1, failed: 0, remaining: 0 });
    expect(progress).toEqual(expect.arrayContaining([
      { phase: 'knowledge', done: 0, total: 1, failed: 0 },
      { phase: 'knowledge', done: 1, total: 1, failed: 0 },
    ]));
    expect(await dispatchJobWithConnection('reembedAll', {}, ctx.sqlite, checkpoint, ctx.service)).toBe(1);
    await expect(dispatchJobWithConnection('embedMissing', {}, ctx.sqlite)).rejects.toThrow('Embedding service unavailable');
    await expect(dispatchJobWithConnection('reembedAll', {}, ctx.sqlite)).rejects.toThrow('Embedding service unavailable');
  });

  it('dispatches health and duplicate job kinds and reports unknown jobs', async () => {
    ctx = makeDb();
    expect(await dispatchJobWithConnection('health', {}, ctx.sqlite)).toMatchObject({ database: true, sqliteVec: true });
    expect(await dispatchJobWithConnection('duplicates.pairs', {}, ctx.sqlite)).toEqual({ result: [], fingerprint: expect.any(String) });
    expect(await dispatchJobWithConnection('duplicates.groups', {}, ctx.sqlite)).toEqual({ result: [], fingerprint: expect.any(String) });
    await expect(dispatchJobWithConnection('unknown' as any, {}, ctx.sqlite)).rejects.toThrow('Unknown job kind');
  });
});
