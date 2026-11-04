import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchJobWithConnection } from '../src/jobs/dispatch.js';
import { sweepStaleExports } from '../src/jobs/export-files.js';
import { makeDb } from './helpers.js';

const fsMock = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const { Writable } = await import('node:stream');
  return {
    ...actual,
    createWriteStream: ((...args: Parameters<typeof actual.createWriteStream>) => fsMock.fail
      ? new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' })); } })
      : actual.createWriteStream(...args)) as typeof actual.createWriteStream,
  };
});

describe('export job', () => {
  const contexts: ReturnType<typeof makeDb>[] = [];
  afterEach(() => { for (const ctx of contexts.splice(0)) ctx.cleanup(); });

  it('exports selected sections and plan tasks with normalized timestamps', async () => {
    const ctx = makeDb(); contexts.push(ctx);
    ctx.sqlite.exec(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at) VALUES
      ('k','Knowledge','body','[]','note','global','test','2026-10-01','2026-10-01'),
      ('sys','System','hidden','[]','system','global','test','2026-10-01','2026-10-01');
      INSERT INTO plans(id,title,content,tags,scope,source,status,created_at,updated_at) VALUES('p','Plan','body','[]','global','test','draft','2026-10-01','2026-10-01');
      INSERT INTO plan_tasks(id,plan_id,description,status,priority,notes,position,created_at,updated_at) VALUES('t','p','Task','pending','medium','','0','2026-10-01','2026-10-01');`);
    for (const include of [['knowledge'], ['plans'], ['knowledge', 'plans']]) {
      const file = await dispatchJobWithConnection('exportToFile', { include, version: '1' }, ctx.sqlite);
      const text = await (await import('node:fs/promises')).readFile(file.path, 'utf8');
      expect(Buffer.byteLength(text)).toBe(file.bytes);
      const body = JSON.parse(text);
      expect(Object.keys(body).sort()).toEqual(['version', 'exportedAt', ...include].sort());
      expect(text).not.toContain('System');
      if (body.knowledge) expect(body.knowledge[0].createdAt).toBe('2026-10-01T00:00:00.000Z');
      if (body.plans) {
        expect(body.plans[0].createdAt).toBe('2026-10-01T00:00:00.000Z');
        expect(body.plans[0].tasks).toHaveLength(1);
      }
      await rmSync(join(file.path, '..'), { recursive: true, force: true });
    }
  });

  it('paginates tie timestamps exactly once in created_at/id descending order', async () => {
    const ctx = makeDb(); contexts.push(ctx);
    const insert = ctx.sqlite.prepare(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at) VALUES(?,?,?,'[]','note','global','test',?,?)`);
    for (let i = 0; i < 620; i++) insert.run(`id-${String(i).padStart(4, '0')}`, `T${i}`, 'body', '2026-10-01', '2026-10-01');
    const query = `SELECT id,title,content,tags,type,scope,source,confidence_score,agent_id,created_at,updated_at FROM knowledge_entries WHERE type != 'system' AND created_at <= ? AND (created_at < ? OR id < ?) ORDER BY created_at DESC,id DESC LIMIT 250`;
    const plan = JSON.stringify(ctx.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all('2026-10-01', '2026-10-01', 'id-0500'));
    expect(plan).toContain('SEARCH'); expect(plan).toContain('idx_knowledge_created_at');
    const file = await dispatchJobWithConnection('exportToFile', { include: ['knowledge'], version: '1' }, ctx.sqlite);
    const body = JSON.parse(await (await import('node:fs/promises')).readFile(file.path, 'utf8'));
    expect(body.knowledge.map((x: any) => x.title)).toEqual(Array.from({ length: 620 }, (_, i) => `T${i}`).reverse());
    await rmSync(join(file.path, '..'), { recursive: true, force: true });
  });

  it('aborts and removes its export directory', async () => {
    const ctx = makeDb(); contexts.push(ctx);
    const insert = ctx.sqlite.prepare(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at) VALUES(?,?,?,'[]','note','global','test','2026-10-01','2026-10-01')`);
    for (let i = 0; i < 400; i++) insert.run(`id${i}`, 'title', 'body');
    const controller = new AbortController();
    await expect(dispatchJobWithConnection('exportToFile', { include: ['knowledge'], version: '1' }, ctx.sqlite, async () => controller.abort(), undefined, controller.signal)).rejects.toMatchObject({ code: 'ABORT_ERR' });
  });

  it('rejects stream write failures and removes the export directory', async () => {
    const ctx = makeDb(); contexts.push(ctx);
    ctx.sqlite.exec(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at) VALUES
      ('failure','Failure','body','[]','note','global','test','2026-10-01','2026-10-01')`);
    const before = readdirSync(tmpdir()).filter((entry) => entry.startsWith('cognistore-export-')).sort();
    try {
      fsMock.fail = true;
      await expect(dispatchJobWithConnection('exportToFile', { include: ['knowledge'], version: '1' }, ctx.sqlite)).rejects.toMatchObject({ code: 'ENOSPC' });
    } finally {
      fsMock.fail = false;
    }
    const after = readdirSync(tmpdir()).filter((entry) => entry.startsWith('cognistore-export-')).sort();
    expect(after).toEqual(before);
  });

  it('sweeps only stale export directories', async () => {
    const base = mkdtempSync(join(tmpdir(), 'export-sweep-test-'));
    const old = join(base, 'cognistore-export-old'); const fresh = join(base, 'cognistore-export-fresh');
    const other = join(base, 'other');
    for (const path of [old, fresh, other]) { const { mkdirSync } = await import('node:fs'); mkdirSync(path); }
    const past = new Date(Date.now() - 60_000); utimesSync(old, past, past);
    await sweepStaleExports(10_000, base);
    expect(existsSync(old)).toBe(false); expect(existsSync(fresh)).toBe(true); expect(existsSync(other)).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });
});
