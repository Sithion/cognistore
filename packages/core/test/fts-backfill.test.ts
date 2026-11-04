import { afterEach, describe, expect, it } from 'vitest';
import { dispatchJobWithConnection } from '../src/jobs/dispatch.js';
import { makeDb } from './helpers.js';

describe('FTS coverage repair', () => {
  const contexts: ReturnType<typeof makeDb>[] = [];
  afterEach(() => { for (const ctx of contexts.splice(0)) ctx.cleanup(); });

  function seed(ctx: ReturnType<typeof makeDb>, count: number) {
    const insert = ctx.sqlite.prepare(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at)
      VALUES(?,?,?,'["original"]','fact','global','test','2026-10-01','2026-10-01')`);
    const indexed = ctx.sqlite.prepare('INSERT INTO knowledge_fts(id,title,content,tags) VALUES(?,?,?,?)');
    for (let i = 0; i < count; i++) {
      const id = `fts-${String(i).padStart(4, '0')}`;
      insert.run(id, `Title ${i}`, `content ${i}`);
      if (i % 3 !== 0) indexed.run(id, `Title ${i}`, `content ${i}`, 'original');
    }
  }

  it('counts only missing non-system rows and scans coverage without a correlated FTS lookup', () => {
    const ctx = makeDb(); contexts.push(ctx);
    seed(ctx, 6);
    ctx.sqlite.prepare(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at)
      VALUES('system-1','System','private','[]','system','global','test','now','now')`).run();
    expect(ctx.repository.countMissingFts()).toBe(2);
    const sql = `SELECT rowid, id FROM knowledge_entries WHERE rowid > ? AND type != 'system'
      AND id NOT IN (SELECT id FROM knowledge_fts) ORDER BY rowid LIMIT ?`;
    const plan = JSON.stringify(ctx.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(0, 250));
    expect(plan).not.toMatch(/CORRELATED.*knowledge_fts/i);
  });

  it('repairs missing rows over multiple pages, uses current content, and is idempotent', async () => {
    const ctx = makeDb(); contexts.push(ctx);
    seed(ctx, 620);
    ctx.sqlite.prepare("UPDATE knowledge_entries SET content='updated current payload' WHERE id='fts-0000'").run();
    const result = await dispatchJobWithConnection('ftsBackfill', {}, ctx.sqlite, undefined, ctx.service);
    expect(result).toEqual({ changes: 207 });
    expect(ctx.repository.countMissingFts()).toBe(0);
    expect(ctx.sqlite.prepare("SELECT content FROM knowledge_fts WHERE id='fts-0000'").get()).toEqual({ content: 'updated current payload' });
    expect((await dispatchJobWithConnection('ftsBackfill', {}, ctx.sqlite, undefined, ctx.service)).changes).toBe(0);
    expect(ctx.sqlite.prepare('SELECT id,count(*) AS n FROM knowledge_fts GROUP BY id HAVING n > 1').all()).toEqual([]);
  });

  it('aborts after a committed batch and a later run repairs the rest', async () => {
    const ctx = makeDb(); contexts.push(ctx);
    seed(ctx, 620);
    ctx.sqlite.exec('DELETE FROM knowledge_fts');
    const controller = new AbortController();
    await expect(ctx.service.ftsBackfill({ signal: controller.signal, checkpoint: async (done) => {
      if (done >= 250) controller.abort();
    } })).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(ctx.repository.countMissingFts()).toBeGreaterThan(0);
    await dispatchJobWithConnection('ftsBackfill', {}, ctx.sqlite, undefined, ctx.service);
    expect(ctx.repository.countMissingFts()).toBe(0);
  });
});
