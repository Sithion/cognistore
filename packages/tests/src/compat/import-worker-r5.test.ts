import { test, expect } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { fixture, seed, forbidMain, deferred } from '../r5-worker-helpers.js';

const entry = { title: 'Fixed import', content: 'fixed content',
  tags: ['fixed'], type: 'pattern', scope: 'global', source: '' };

test('worker import skips same-batch duplicates, avoids listAll and flushes on immediate close', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    const before = (f.sqlite.prepare("SELECT count(*) AS n FROM operations_log WHERE operation='write'").get() as { n: number }).n;
    restore = forbidMain(['importKnowledge'], ['listAll']);
    expect(await f.sdk.importKnowledge([entry, entry] as any)).toEqual({ imported: 1, skipped: 1, errors: [] });
    expect(await f.sdk.importKnowledge([entry] as any)).toEqual({ imported: 0, skipped: 1, errors: [] });
    await f.sdk.close();
    const other = new BetterSqlite3(f.path);
    try {
      expect(other.prepare("SELECT source FROM knowledge_entries WHERE title='Fixed import'").get()).toEqual({ source: 'import' });
      expect(other.prepare("SELECT count(*) AS n FROM operations_log WHERE operation='write'").get()).toEqual({ n: before + 1 });
      expect(other.prepare("SELECT length(content_hash) AS n FROM knowledge_entries WHERE title='Fixed import'").get()).toEqual({ n: 64 });
    } finally { other.close(); }
  } finally { restore(); await f.close(); }
});

for (const oldAction of ['insert', 'edit']) {
  test(`final locked NULL-hash recheck sees old-style ${oldAction} during embedding`, async () => {
    const f = await fixture();
    const entered = deferred();
    const release = deferred();
    let restore = () => {};
    try {
      if (oldAction === 'edit') seed(f.sqlite, 1);
      const old = new BetterSqlite3(f.path);
      f.mock.setHook(async () => { entered.resolve(); await release.promise; });
      restore = forbidMain(['importKnowledge'], ['listAll']);
      const importing = f.sdk.importKnowledge([entry] as any);
      await entered.promise;
      try {
        if (oldAction === 'insert') {
          old.prepare(`INSERT INTO knowledge_entries
            (id,title,content,tags,type,scope,source,created_at,updated_at)
            VALUES ('old-fixed',?,?,'["fixed"]','pattern','global','old','2026-10-01','2026-10-01')`)
            .run(entry.title, entry.content);
        } else {
          old.prepare("UPDATE knowledge_entries SET title=?,content=?,updated_at='2026-10-02' WHERE id='id-00000'")
            .run(entry.title, entry.content);
        }
      } finally { old.close(); }
      release.resolve();
      expect(await importing).toEqual({ imported: 0, skipped: 1, errors: [] });
      expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_entries WHERE title=? AND content=?')
        .get(entry.title, entry.content)).toEqual({ n: 1 });
      expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_entries WHERE content_hash IS NULL').get())
        .toEqual({ n: 0 });
    } finally { release.resolve(); restore(); await f.close(); }
  });
}

test('hash backfill cancels at one committed page and resumes', async () => {
  const f = await fixture();
  const runner = f.runner();
  const controller = new AbortController();
  try {
    seed(f.sqlite, 501);
    const result = await Promise.allSettled([runner.run('hashBackfill', {}, {
      signal: controller.signal, onProgress: () => controller.abort(),
    })]);
    expect(result[0].status).toBe('rejected');
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_entries WHERE content_hash IS NOT NULL').get())
      .toEqual({ n: 250 });
    await runner.run('hashBackfill', {});
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM knowledge_entries WHERE content_hash IS NULL').get())
      .toEqual({ n: 0 });
  } finally { await runner.close(); await f.close(); }
});
