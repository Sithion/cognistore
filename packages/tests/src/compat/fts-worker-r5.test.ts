import { test, expect } from '@playwright/test';
import { fixture, seed, forbidMain, startSdk } from '../r5-worker-helpers.js';

test('cancelled nonempty repair resumes after SDK reopen and covers batch two', async () => {
  const f = await fixture();
  const runner = f.runner();
  const abort = new AbortController();
  let restore = () => {};
  let reopened: Awaited<ReturnType<typeof startSdk>> | undefined;
  try {
    seed(f.sqlite, 501);
    f.sqlite.exec('DELETE FROM knowledge_fts');
    await expect(runner.run('ftsBackfill', {}, {
      signal: abort.signal, onProgress: (value) => { const progress = value as { phase?: string; done?: number }; if (progress?.phase === 'ftsBackfill' && (progress.done ?? 0) >= 250) abort.abort(); },
    })).rejects.toThrow();
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_fts').get()).toEqual({ n: 250 });
    expect(f.sqlite.prepare("SELECT id FROM knowledge_fts WHERE id='id-00500'").get()).toBeUndefined();
    await runner.close();
    await f.sdk.close();
    restore = forbidMain([], ['backfillFts', 'backfillFtsIfNeeded']);
    reopened = await startSdk(f.path);
    await reopened.sdk.waitForFtsRepair();
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_fts').get()).toEqual({ n: 501 });
    expect(f.sqlite.prepare(`SELECT k.id FROM knowledge_entries k
      WHERE NOT EXISTS (SELECT 1 FROM knowledge_fts f WHERE f.id=k.id) LIMIT 1`).get()).toBeUndefined();
    expect(f.sqlite.prepare('SELECT id,count(*) AS n FROM knowledge_fts GROUP BY id HAVING n!=1').all()).toEqual([]);
    const hits = await reopened.sdk.getKnowledge('Content 500', { threshold: 0, limit: 100 });
    expect(hits.map((h) => h.entry.id)).toContain('id-00500');
  } finally {
    restore();
    await reopened?.close();
    await runner.close();
    await f.close();
  }
});

test('nonempty duplicates do not conceal a missing row; complete rerun is idempotent', async () => {
  const f = await fixture();
  const runner = f.runner();
  try {
    seed(f.sqlite, 2);
    f.sqlite.exec(`DELETE FROM knowledge_fts;
      INSERT INTO knowledge_fts(id,title,content,tags) VALUES('id-00000','Title 0','fixed','');
      INSERT INTO knowledge_fts(id,title,content,tags) VALUES('id-00000','Title 0','fixed','');`);
    await runner.run('ftsBackfill', {});
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM knowledge_fts WHERE id='system-00000'").get()).toEqual({ n: 0 });
    expect(f.sqlite.prepare("SELECT id FROM knowledge_fts WHERE id='id-00001'").get())
      .toEqual({ id: 'id-00001' });
    const before = f.sqlite.prepare('SELECT rowid,id,title,content,tags FROM knowledge_fts ORDER BY rowid').all();
    await runner.run('ftsBackfill', {});
    expect(f.sqlite.prepare('SELECT rowid,id,title,content,tags FROM knowledge_fts ORDER BY rowid').all()).toEqual(before);
    expect(f.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { await runner.close(); await f.close(); }
});
