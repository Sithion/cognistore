import { test, expect } from '@playwright/test';
import { KnowledgeRepository } from '@cognistore/core';
import { fixture, forbidMain } from '../r5-worker-helpers.js';

test('SDK duplicate results equal core results and never call the parent implementation', async () => {
  const f = await fixture();
  let restore = () => {};
  try {
    const repo = new KnowledgeRepository(f.db, f.sqlite);
    const vector = [1, ...Array(255).fill(0)];
    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      await repo.create({ title, content: 'shared fixed content', tags: ['fixed'],
        type: 'pattern', scope: 'global', source: 'r5', embedding: vector } as any);
    }
    await repo.create({ title: 'System duplicate', content: 'shared fixed content', tags: ['fixed'], type: 'system', scope: 'global', source: 'r5', embedding: vector } as any);
    const expectedPairs = await repo.findDuplicatePairs({ threshold: 0.99 });
    const expectedGroups = await repo.findDuplicateGroups({ threshold: 0.99 });
    expect(expectedPairs).toHaveLength(3);
    expect(expectedGroups).toHaveLength(1);
    expect(expectedGroups[0].members).toHaveLength(3);
    restore = forbidMain(['findDuplicatePairs', 'findDuplicateGroups']);
    expect(await f.sdk.findDuplicatePairs({ threshold: 0.99 })).toEqual(expectedPairs);
    expect(await f.sdk.findDuplicateGroups({ threshold: 0.99 })).toEqual(expectedGroups);
    expect(await f.sdk.findDuplicateGroups({ threshold: 0.99 })).toEqual(expectedGroups);
    const id = expectedGroups[0].members[0].id;
    f.sqlite.prepare('DELETE FROM knowledge_entries WHERE id=?').run(id);
    const after = await f.sdk.findDuplicateGroups({ threshold: 0.99 });
    expect(after).toHaveLength(1);
    expect(after[0].members).toHaveLength(2);
    expect(after[0].members.map((m: any) => m.id)).not.toContain(id);
    const beforeReembed = await f.sdk.findDuplicateGroups({ threshold: 0.99 });
    f.mock.setHook(async () => { await new Promise((resolve) => setTimeout(resolve, 1)); });
    await f.sdk.reembedAll();
    expect(await f.sdk.findDuplicateGroups({ threshold: 0.99 })).toEqual(beforeReembed);
    const remainingId = after[0].members[0].id;
    const row = await f.sdk.getKnowledgeById(remainingId);
    await f.sdk.updateKnowledge(remainingId, { title: `${row!.title} edited` } as any);
    expect(await f.sdk.findDuplicateGroups({ threshold: 0.99 })).toHaveLength(1);
  } finally { restore(); await f.close(); }
});

test('duplicate worker cancellation rejects with ABORT_ERR and the next job runs', async () => {
  const f = await fixture();
  try {
    const repo = new KnowledgeRepository(f.db, f.sqlite);
    const vector = [1, ...Array(255).fill(0)];
    for (let i = 0; i < 1800; i++) await repo.create({ title: `Entry ${i}`, content: `Entry ${i}`, tags: [], type: 'pattern', scope: 'global', source: 'r5', embedding: vector } as any);
    const controller = new AbortController();
    await f.sdk.findDuplicateGroups({ threshold: 0.99, limit: 500 });
    controller.abort();
    const cancelled = f.sdk.findDuplicateGroups({ threshold: 0.98, signal: controller.signal });
    await expect(cancelled).rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(await f.sdk.run('duplicates.groups', { threshold: 1, limit: 1 })).toMatchObject({ result: expect.any(Array) });
  } finally { await f.close(); }
});

test('SDK cleanup report obtains duplicate groups in the JobRunner worker', async () => {
  const f = await fixture();
  const restore = forbidMain(['findDuplicateGroups']);
  try {
    const repo = new KnowledgeRepository(f.db, f.sqlite);
    const vector = [1, ...Array(255).fill(0)];
    await repo.create({ title: 'Cleanup A', content: 'cleanup duplicate content', tags: [], type: 'pattern', scope: 'global', source: 'r5', embedding: vector } as any);
    await repo.create({ title: 'Cleanup B', content: 'cleanup duplicate content', tags: [], type: 'decision', scope: 'global', source: 'r5', embedding: vector } as any);
    const result = await f.sdk.generateCleanupReport({ dupThreshold: 0.99 });
    expect(result.report.stats.counts.duplicateGroups).toBeGreaterThan(0);
  } finally { restore(); await f.close(); }
});
