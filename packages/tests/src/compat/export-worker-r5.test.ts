import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixture, seed, forbidMain } from '../r5-worker-helpers.js';

test('worker exports fixed schema, omits system rows, and cleans private files', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    seed(f.sqlite, 1);
    f.sqlite.exec(`INSERT INTO knowledge_entries
      (id,title,content,tags,type,scope,source,created_at,updated_at)
      VALUES('sys','Secret','hidden','[]','system','global','r5','2026-10-01','2026-10-01')`);
    f.sqlite.exec(`INSERT INTO plans(id,title,content,tags,scope,status,source,created_at,updated_at)
      VALUES('plan-fixed','Plan','fixed','[]','global','draft','r5','2026-10-01','2026-10-01')`);
    restore = forbidMain([], ['listAll']);
    const paths: string[] = [];
    for (const include of [['knowledge'], ['plans'], ['knowledge', 'plans']]) {
      const file = await f.sdk.exportToFile({
        include, version: '2.5.4', exportedAt: '2026-10-29T00:00:00.000Z',
      });
      paths.push(file.path);
      const text = readFileSync(file.path, 'utf8');
      expect(Buffer.byteLength(text)).toBe(file.bytes);
      const body = JSON.parse(text);
      expect(body.version).toBe('2.5.4');
      expect(body.exportedAt).toBe('2026-10-29T00:00:00.000Z');
      expect(Object.keys(body).sort()).toEqual(['version', 'exportedAt', ...include].sort());
      if (include.includes('knowledge')) {
        expect(body.knowledge).toHaveLength(1);
        expect(body.knowledge[0]).toMatchObject({
          title: 'Title 0', content: 'Content 0', tags: [],
          type: 'note', scope: 'global', source: 'r5',
        });
      }
      if (include.includes('plans')) {
        expect(body.plans).toHaveLength(1);
        expect(body.plans[0]).toMatchObject({ title: 'Plan', status: 'draft', tasks: [] });
      }
      expect(text).not.toContain('Secret');
    }
    await f.sdk.releaseExport(paths[0]);
    expect(existsSync(paths[0])).toBe(false);
    expect(existsSync(dirname(paths[0]))).toBe(false);
    await f.sdk.close();
    for (const path of paths) { expect(existsSync(path)).toBe(false); expect(existsSync(dirname(path))).toBe(false); }
  } finally { restore(); await f.close(); }
});
