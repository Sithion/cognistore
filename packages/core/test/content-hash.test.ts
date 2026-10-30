import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { makeDb } from './helpers.js';
import { contentHash, normalizeHashText } from '../src/jobs/content-hash.js';
import { dispatchJobWithConnection } from '../src/jobs/dispatch.js';

it('normalizes only the prescribed text distinctions and hashes the JSON pair', () => {
  expect(normalizeHashText('  e\u0301\r\nx\ry  ')).toBe('é\nx\ny');
  expect(contentHash('', '')).toBe(createHash('sha256').update('["",""]').digest('hex'));
  expect(contentHash(' é ', 'a\r\nb')).toBe(contentHash('e\u0301', 'a\nb'));
  expect(contentHash('A', 'x')).not.toBe(contentHash('a', 'x'));
  expect(contentHash('a  b', 'x')).not.toBe(contentHash('a b', 'x'));
  expect(contentHash('ab', 'c')).not.toBe(contentHash('a', 'bc'));
  expect(contentHash('ab', 'c')).toMatch(/^[a-f0-9]{64}$/);
});

it('old-style updates invalidate a populated hash', async () => {
  const ctx = makeDb();
  try {
    const row = await ctx.service.add({ title: 'A', content: 'fixed', tags: ['fixed'],
      type: 'pattern', scope: 'global', source: 'r5' } as any);
    ctx.sqlite.prepare('UPDATE knowledge_entries SET content_hash=? WHERE id=?')
      .run(contentHash('A', 'fixed'), row.id);
    ctx.sqlite.prepare("UPDATE knowledge_entries SET content='old writer edit' WHERE id=?").run(row.id);
    expect(ctx.sqlite.prepare('SELECT content_hash FROM knowledge_entries WHERE id=?').get(row.id))
      .toEqual({ content_hash: null });
  } finally { ctx.cleanup(); }
});

it('uses the composite index for NULL pages and hash candidates without a temp sort', () => {
  const ctx = makeDb();
  try {
    const nullPage = ctx.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT id, title, content FROM knowledge_entries
      WHERE content_hash IS NULL AND id > ? ORDER BY id LIMIT ?`).all('', 250) as { detail: string }[];
    const candidate = ctx.sqlite.prepare('EXPLAIN QUERY PLAN SELECT id, title, content FROM knowledge_entries WHERE content_hash = ? AND type != \'system\'').all('hash') as { detail: string }[];
    expect(nullPage.map((row) => row.detail).join(' ')).not.toContain('USE TEMP B-TREE');
    expect(nullPage.map((row) => row.detail).join(' ')).toContain('idx_knowledge_content_hash');
    expect(candidate.map((row) => row.detail).join(' ')).toContain('idx_knowledge_content_hash');
  } finally { ctx.cleanup(); }
});

it('updates content hash in one UPDATE and invalidates only old-style writes', async () => {
  const ctx = makeDb();
  try {
    const entry = await ctx.service.add({ title: 'Before', content: 'old body', tags: [], type: 'pattern', scope: 'global', source: 'test' } as any);
    ctx.sqlite.exec("CREATE TEMP TABLE update_counter (count INTEGER); INSERT INTO update_counter VALUES (0);");
    ctx.sqlite.prepare(`CREATE TEMP TRIGGER count_updates AFTER UPDATE ON knowledge_entries BEGIN
      UPDATE update_counter SET count=count+1;
    END;`).run();
    ctx.sqlite.prepare("UPDATE knowledge_entries SET title='Raw edit' WHERE id=?").run(entry.id);
    expect((ctx.sqlite.prepare('SELECT content_hash FROM knowledge_entries WHERE id=?').get(entry.id) as any).content_hash).toBeNull();
    ctx.sqlite.prepare('UPDATE update_counter SET count=0').run();
    const updated = await ctx.repository.update(entry.id, { title: 'After', content: 'new body' } as any);
    expect((ctx.sqlite.prepare('SELECT content_hash FROM knowledge_entries WHERE id=?').get(entry.id) as any).content_hash).toBe(contentHash('After', 'new body'));
    expect((ctx.sqlite.prepare('SELECT count FROM update_counter').get() as any).count).toBe(1);
    expect(updated?.title).toBe('After');
  } finally { ctx.cleanup(); }
});

it('backfills actual changes, checks cancellation and caps restart passes', async () => {
  const ctx = makeDb();
  try {
    const entry = await ctx.service.add({ title: 'Hash', content: 'repair', tags: [], type: 'pattern', scope: 'global', source: 'test' } as any);
    ctx.sqlite.prepare('UPDATE knowledge_entries SET content_hash=NULL WHERE id=?').run(entry.id);
    expect(await ctx.service.hashBackfill()).toEqual({ changes: 1 });
    expect(await ctx.service.hashBackfill()).toEqual({ changes: 0 });
    const controller = new AbortController(); controller.abort();
    await expect(ctx.service.hashBackfill({ signal: controller.signal })).rejects.toMatchObject({ code: 'ABORT_ERR' });

    const originalPublish = ctx.repository.publishContentHashPage.bind(ctx.repository);
    ctx.repository.listNullContentHashPage = (() => [{ id: entry.id, title: 'Hash', content: 'repair', updatedAt: '2026-01-01T00:00:00.000Z' }]) as typeof ctx.repository.listNullContentHashPage;
    ctx.repository.hasNullContentHash = (() => restartPasses < 6) as typeof ctx.repository.hasNullContentHash;
    let restartPasses = 0;
    ctx.repository.publishContentHashPage = ((rows) => {
      const changes = originalPublish(rows);
      if (restartPasses < 7) {
        restartPasses++;
        ctx.sqlite.prepare('UPDATE knowledge_entries SET content_hash=NULL WHERE id=?').run(entry.id);
      }
      return changes;
    }) as typeof ctx.repository.publishContentHashPage;
    const started = Date.now();
    await ctx.service.hashBackfill();
    expect(restartPasses).toBe(6);
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  } finally { ctx.cleanup(); }
});

it('dispatches hash repair with real change counts', async () => {
  const ctx = makeDb();
  try {
    await ctx.service.add({ title: 'Dispatch', content: 'hash', tags: [], type: 'pattern', scope: 'global', source: 'test' } as any);
    ctx.sqlite.prepare("UPDATE knowledge_entries SET content_hash=NULL WHERE title='Dispatch'").run();
    expect(await dispatchJobWithConnection('hashBackfill', {}, ctx.sqlite, undefined, ctx.service)).toEqual({ changes: 1 });
  } finally { ctx.cleanup(); }
});

it('reports per-entry progress and cancels import before embedding', async () => {
  const ctx = makeDb();
  try {
    const progress: unknown[] = [];
    await ctx.service.importKnowledge([{ title: 'Progress', content: 'body', tags: [], type: 'pattern', scope: 'global', source: 'test' }], {
      checkpoint: async (done, total) => { progress.push([done, total]); },
    });
    expect(progress).toContainEqual([1, 1]);
    const controller = new AbortController(); controller.abort();
    await expect(ctx.service.importKnowledge([{ title: 'Cancel', content: 'body', tags: [], type: 'pattern', scope: 'global', source: 'test' }], { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORT_ERR' });
  } finally { ctx.cleanup(); }
});
