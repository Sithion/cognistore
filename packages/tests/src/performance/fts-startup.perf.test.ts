import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient } from '../../../core/src/db/client.js';
import { KnowledgeRepository } from '../../../core/src/repositories/knowledge.repository.js';
import { KnowledgeSDK } from '@cognistore/sdk';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';
import { startMockOllama } from '../sidecar-helpers.js';
import { dispatchJobWithConnection } from '../../../core/src/jobs/dispatch.js';
import { KnowledgeService } from '../../../core/src/services/knowledge.service.js';
import { report } from './fixtures/perf-helpers.js';

test.describe.configure({ mode: 'serial' });
test('10k complete FTS coverage keeps SDK initialization fast @perf', async () => {
  test.skip(process.env.PERF !== '1', 'Set PERF=1 to run performance tests');
  test.setTimeout(180_000);
  const home = mkdtempSync(join(tmpdir(), 'cognistore-perf-fts-'));
  let mock: Awaited<ReturnType<typeof startMockOllama>> | undefined;
  let sdk: KnowledgeSDK | undefined;
  try {
    const path = join(home, 'knowledge.db');
    const { db, sqlite } = createDbClient(path);
    const repo = new KnowledgeRepository(db, sqlite);
    for (let i = 0; i < 10_000; i++) await repo.create({ title: `FTS ${i}`, content: `Keyword payload ${i}`, tags: [], type: 'pattern' as any, scope: 'global', source: 'perf', embedding: new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0) });
    const checkStarted = performance.now();
    const missing = repo.countMissingFts();
    const checkDuration = performance.now() - checkStarted;
    expect(missing).toBe(0);
    sqlite.close();
    mock = await startMockOllama('nomic-embed-text');
    sdk = new KnowledgeSDK({ database: { path }, ollama: { host: `http://127.0.0.1:${mock.port}`, model: 'nomic-embed-text', dimensions: DEFAULT_EMBEDDING_DIMENSIONS } });
    const started = performance.now();
    await sdk.initialize();
    const duration = performance.now() - started;
    report('fts.init.10k', duration);
    report('fts.countMissing.10k', checkDuration);
    expect(duration).toBeLessThan(5000);
    expect(checkDuration).toBeLessThan(100);
  } finally {
    await sdk?.close();
    if (mock) await new Promise<void>((resolve) => mock!.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});

test('10k partial FTS repair bounds each write batch @perf', async () => {
  test.skip(process.env.PERF !== '1', 'Set PERF=1 to run performance tests');
  test.setTimeout(180_000);
  const home = mkdtempSync(join(tmpdir(), 'cognistore-perf-fts-repair-'));
  const { db, sqlite } = createDbClient(join(home, 'knowledge.db'));
  const repo = new KnowledgeRepository(db, sqlite);
  try {
    const insert = sqlite.prepare(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at)
      VALUES(?,?,?,'[]','pattern','global','perf','now','now')`);
    const fts = sqlite.prepare('INSERT INTO knowledge_fts(id,title,content,tags) VALUES(?,?,?,?)');
    for (let i = 0; i < 10_000; i++) {
      const id = `repair-${i}`;
      insert.run(id, `Title ${i}`, `Body ${i}`);
      if (i % 10 !== 0) fts.run(id, `Title ${i}`, `Body ${i}`, '');
    }
    const service = new KnowledgeService(repo, { async embed() { return new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0); } });
    const original = repo.repairFtsIds.bind(repo);
    let max = 0;
    repo.repairFtsIds = (ids) => {
      const started = performance.now();
      try { return original(ids); } finally { max = Math.max(max, performance.now() - started); }
    };
    await dispatchJobWithConnection('ftsBackfill', {}, sqlite, undefined, service);
    report('fts.repairBatchMax', max);
    expect(repo.countMissingFts()).toBe(0);
    expect(max).toBeLessThan(50);
  } finally { sqlite.close(); rmSync(home, { recursive: true, force: true }); }
});
