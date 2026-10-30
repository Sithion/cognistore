import { afterEach, describe, expect, it } from 'vitest';
import { makeDb, stubEmbedding } from './helpers.js';

describe('KnowledgeRepository', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => ctx?.cleanup());

  async function add(title: string, extra: Record<string, unknown> = {}) {
    return ctx.repository.create({
      title, content: `${title} content`, type: 'pattern', scope: 'project', source: 'test',
      tags: [], embedding: stubEmbedding(`${title} content`), ...extra,
    } as any);
  }
  function plan(title = 'Plan', extra: Record<string, unknown> = {}) {
    return ctx.repository.createPlan({ title, content: `${title} body`, tags: [], scope: 'project', source: 'test', embedding: stubEmbedding(title), ...extra } as any);
  }

  describe('entries and search', () => {
    it('creates entry and embedding atomically, reads it, updates version and removes both', async () => {
      ctx = makeDb();
      const created = await add('Alpha', { tags: ['alpha'], agentId: 'agent-a', platform: 'cli' });
      expect(await ctx.repository.findById(created.id)).toMatchObject({ id: created.id, title: 'Alpha', version: 1 });
      expect(ctx.sqlite.prepare('SELECT id FROM knowledge_embeddings_rowids WHERE id = ?').get(created.id)).toBeDefined();
      const updated = await ctx.repository.update(created.id, { title: 'Beta', expiresAt: new Date('2030-01-01T00:00:00Z'), embedding: stubEmbedding('Beta') });
      expect(updated).toMatchObject({ title: 'Beta', version: 2, expiresAt: '2030-01-01T00:00:00.000Z' });
      expect(await ctx.repository.update('missing', { title: 'x' })).toBeNull();
      expect(await ctx.repository.delete(created.id)).toMatchObject({ id: created.id });
      expect(await ctx.repository.delete(created.id)).toBeNull();
      expect(ctx.sqlite.prepare('SELECT id FROM knowledge_embeddings_rowids WHERE id = ?').get(created.id)).toBeUndefined();
    });

    it('lists recent entries with metadata, tags and offset while excluding system rows', async () => {
      ctx = makeDb();
      await add('One', { tags: ['red'], agentId: 'a', platform: 'cli' });
      await add('Two', { tags: ['blue'], agentId: null, platform: 'unknown' });
      await add('Three', { tags: ['red'], agentId: 'b', platform: null });
      await add('System', { type: 'system' });
      expect((await ctx.repository.listRecent(20, { tags: ['red'], agent: 'a', platform: 'cli' })).map(x => x.title)).toEqual(['One']);
      expect((await ctx.repository.listRecent(20, { agent: 'unspecified', platform: 'unknown' })).map(x => x.title)).toContain('Two');
      const all = await ctx.repository.listRecent(20);
      expect(all.map(x => x.title)).not.toContain('System');
      expect((await ctx.repository.listRecent(1, undefined, 1))[0].title).toBe(all[1].title);
    });

    it('searches by similarity with scope/global, tag, type and threshold filters; query text enables FTS', async () => {
      ctx = makeDb();
      const local = await add('SQLite WAL writer', { tags: ['db'], scope: 'repo' });
      await add('Global SQLite writer', { tags: ['db'], scope: 'global' });
      await add('Other scope', { scope: 'other' });
      await add('System SQLite', { type: 'system' });
      const results = await ctx.repository.searchBySimilarity(stubEmbedding('SQLite WAL writer'), { scope: 'repo', tags: ['db'], type: 'pattern', threshold: 0.1 });
      expect(results.map(x => x.entry.id)).toContain(local.id);
      expect(results.some(x => x.entry.scope === 'global')).toBe(true);
      expect(results.some(x => x.entry.type === 'system' || x.entry.scope === 'other')).toBe(false);
      expect(await ctx.repository.searchBySimilarity(stubEmbedding('unrelated phrase'), { threshold: 1 })).toEqual([]);
      const fts = await ctx.repository.searchBySimilarity(stubEmbedding('unrelated'), { threshold: 1, queryText: '"WAL"' });
      expect(fts.map(x => x.entry.id)).toContain(local.id);
    });

    it('maintains FTS index on create/update/delete', async () => {
      ctx = makeDb();
      const e = await add('Findable', { tags: ['searchtag'] });
      expect(ctx.repository.getKnowledgeEntryRaw(e.id)?.title).toBe('Findable');
      await ctx.repository.update(e.id, { title: 'Renamed', tags: ['newtag'] });
      expect((await ctx.repository.searchBySimilarity(stubEmbedding('none'), { threshold: 1, queryText: 'Renamed' })).map(x => x.entry.id)).toContain(e.id);
    });
  });

  describe('tags, metrics and read tracking', () => {
    it('lists, counts, ranks and merges tags, collapsing duplicate target tags', async () => {
      ctx = makeDb();
      const one = await add('One', { tags: ['old', 'new', 'common'] });
      await add('Two', { tags: ['old', 'common'] });
      await add('System', { type: 'system', tags: ['hidden'] });
      expect(new Set(await ctx.repository.listTags())).toEqual(new Set(['old', 'new', 'common']));
      expect((await ctx.repository.topTags(10)).some(x => x.tag === 'common' && x.count === 2)).toBe(true);
      expect(await ctx.repository.tagCounts()).toEqual(expect.arrayContaining([{ tag: 'old', count: 2 }]));
      expect(ctx.repository.renameTag('absent', 'x')).toEqual([]);
      expect(ctx.repository.renameTag('old', 'new')).toHaveLength(2);
      const stored = JSON.parse(ctx.repository.getKnowledgeEntryRaw(one.id)!.tags);
      expect(stored.sort()).toEqual(['common', 'new']);
    });

    it('aggregates counts by type, scope, agent and platform and supports bounded ranges', async () => {
      ctx = makeDb();
      const e = await add('A', { agentId: 'agent-a', platform: 'cli' });
      await add('B', { type: 'decision', scope: 'global', agentId: null, platform: null });
      await add('System', { type: 'system' });
      expect(await ctx.repository.count()).toBe(2);
      expect(await ctx.repository.countByType()).toEqual(expect.arrayContaining([{ type: 'pattern', count: 1 }, { type: 'decision', count: 1 }]));
      expect(await ctx.repository.countByScope()).toEqual(expect.arrayContaining([{ scope: 'global', count: 1 }]));
      expect(await ctx.repository.countByAgent()).toEqual(expect.arrayContaining([{ agent: 'agent-a', count: 1 }, { agent: 'unspecified', count: 1 }]));
      expect(await ctx.repository.countByPlatform()).toEqual(expect.arrayContaining([{ platform: 'cli', count: 1 }, { platform: 'unknown', count: 1 }]));
      expect(await ctx.repository.countByType({ from: '2000-01-01', to: '2000-02-01' })).toEqual([]);
      expect((await ctx.repository.listAll()).map(x => x.id)).not.toContain((await ctx.repository.findById('missing'))?.id);
      expect(await ctx.repository.lastUpdatedAt()).toBeTruthy();
      expect(e.id).toBeDefined();
    });

    it('marks reads without changing version or updated timestamp and restores busy timeout', async () => {
      ctx = makeDb();
      const e = await add('Read');
      const before = await ctx.repository.findById(e.id);
      const timeout = ctx.sqlite.pragma('busy_timeout', { simple: true });
      ctx.repository.markReadBatch([], 10);
      ctx.repository.markReadBatch([{ id: e.id, count: 3, at: '2026-01-01T00:00:00Z' }], 12);
      const after = await ctx.repository.findById(e.id);
      expect(after).toMatchObject({ readCount: 3, lastReadAt: '2026-01-01T00:00:00Z', version: before!.version, updatedAt: before!.updatedAt });
      expect(ctx.sqlite.pragma('busy_timeout', { simple: true })).toBe(timeout);
      expect(ctx.repository.maxLastReadAt()).toBe('2026-01-01T00:00:00Z');
    });
  });

  describe('cleanup detection and queue', () => {
    it('detects stale, deprecated and unread entries and rechecks removal eligibility', async () => {
      ctx = makeDb();
      const old = await add('Old', { tags: ['deprecated'] });
      const kept = await add('Keep', { tags: ['keep'] });
      const past = new Date(Date.now() - 200 * 86400000).toISOString();
      ctx.sqlite.prepare('UPDATE knowledge_entries SET created_at=?, updated_at=? WHERE id=?').run(past, past, old.id);
      ctx.sqlite.prepare('UPDATE knowledge_entries SET created_at=?, updated_at=? WHERE id=?').run(past, past, kept.id);
      expect(ctx.repository.findDeprecatedEntries().map(x => x.id)).toContain(old.id);
      expect(ctx.repository.findUnreadEntries(90).map(x => x.id)).toContain(old.id);
      expect(ctx.repository.findUnreadEntries(90).map(x => x.id)).not.toContain(kept.id);
      expect(ctx.repository.qualifiesForRemoval(old.id, 'deprecated', 90)).toBe(true);
      expect(ctx.repository.qualifiesForRemoval(kept.id, 'unread', 90)).toBe(false);
      expect(ctx.repository.qualifiesForRemoval('missing', 'deprecated', 90)).toBe(false);
      ctx.repository.markReadBatch([{ id: old.id, count: 1, at: new Date().toISOString() }], 5);
      expect(ctx.repository.qualifiesForRemoval(old.id, 'unread', 90)).toBe(false);
      expect(await ctx.repository.findStaleEntries({ days: 90, minConfidence: 0.99 })).toEqual(expect.arrayContaining([expect.objectContaining({ id: old.id })]));
    });

    it('creates, claims, patches and closes cleanup candidates with conditional transitions', () => {
      ctx = makeDb();
      ctx.repository.createCleanupReport({ id: 'r1', createdAt: '2026-01-01T00:00:00Z', stats: { total: 2 } }, [
        { id: 'c1', category: 'unread', entryIds: ['e1'], payload: { title: 'One' } },
        { id: 'c2', category: 'deprecated', entryIds: ['e2'], payload: {} },
      ]);
      expect(ctx.repository.getOpenCleanupReport()?.id).toBe('r1');
      expect(ctx.repository.getLatestCleanupReport()?.status).toBe('open');
      expect(ctx.repository.getCleanupReportById('absent')).toBeNull();
      expect(ctx.repository.countPendingCleanupCandidates()).toBe(2);
      expect(JSON.parse(ctx.repository.listCleanupCandidates('r1')[0].entryIds)).toHaveLength(1);
      expect(ctx.repository.claimCleanupCandidate('c1', { snapshot: true })).toBe(true);
      expect(ctx.repository.claimCleanupCandidate('c1', {})).toBe(false);
      expect(ctx.repository.updateCleanupCandidate('c1', { status: 'applied', expectedStatus: 'applying' })).toBe(true);
      expect(ctx.repository.updateCleanupCandidate('c1', { status: 'dismissed', expectedStatus: 'pending' })).toBe(false);
      expect(ctx.repository.updateCleanupCandidate('c2', {})).toBe(false);
      ctx.repository.closeCleanupReport('r1', { done: true });
      expect(ctx.repository.getOpenCleanupReport()).toBeNull();
      expect(ctx.repository.getCleanupCandidate('c2')?.status).toBe('dismissed');
      expect(ctx.repository.countPendingCleanupCandidates()).toBe(0);
    });
  });

  describe('operations and plans', () => {
    it('writes operations transactionally, rolls daily totals up and prunes old raw rows', () => {
      ctx = makeDb();
      ctx.repository.logOperationsBuffered([], 10);
      const today = new Date().toISOString();
      ctx.repository.logOperationsBuffered([{ operation: 'read', createdAt: today, count: 2 }, { operation: 'write', createdAt: today, count: 1 }], 10);
      expect(ctx.repository.getOperationCounts()).toMatchObject({ readsLastHour: 2, readsLastDay: 2, writesLastDay: 1 });
      expect(ctx.repository.getOperationsByDay(1)).toHaveLength(1);
      expect(ctx.repository.getOperationsByDay(1)[0]).toMatchObject({ reads: 2, writes: 1 });
      ctx.sqlite.prepare("INSERT INTO operations_log(operation, created_at) VALUES ('read', '2020-01-01T00:00:00.000Z')").run();
      expect(ctx.repository.reconcileOperationsDaily()).toBeGreaterThanOrEqual(0);
      expect(ctx.repository.cleanupOldOperations()).toBe(1);
      expect(ctx.repository.getPlansByDay(2)).toHaveLength(2);
    });

    it('supports plan CRUD, filtering, lineage, embeddings, relations and tasks', async () => {
      ctx = makeDb();
      const root = plan('Root');
      const child = plan('Child', { parentPlanId: root.id, rootPlanId: root.id, status: 'active' });
      expect(ctx.repository.getPlanById(root.id)?.title).toBe('Root');
      expect(ctx.repository.listPlans(10, ['active'], 'project').map(x => x.id)).toContain(child.id);
      expect(() => ctx.repository.listPlans(5, ['nope'])).toThrow(/unknown plan status/);
      expect(ctx.repository.updatePlan(child.id, { tags: ['x'], planFilePath: '/p' })?.plan_file_path).toBe('/p');
      expect(ctx.repository.getPlanChainRows(root.id, 5).map(x => x.id)).toEqual(expect.arrayContaining([root.id, child.id]));
      ctx.repository.setPlanLineage(child.id, root.id, root.id);
      ctx.repository.relinkPlanWithSubtree(child.id, null, null, [], () => {});
      expect(ctx.repository.getPlanById(child.id)?.parent_plan_id).toBeNull();
      const k = ctx.repository.createPlanTask({ planId: root.id, description: 'Task' });
      const k2 = ctx.repository.createPlanTask({ planId: root.id, description: 'Second', status: 'completed' });
      expect(ctx.repository.listPlanTasks(root.id).map(x => x.position)).toEqual([0, 1]);
      expect(ctx.repository.getTaskPlanId(k.id)).toBe(root.id);
      expect(ctx.repository.countIncompleteTasks(root.id)).toBe(1);
      expect(ctx.repository.updatePlanTask(k.id, { status: 'in_progress', notes: 'go' })?.status).toBe('in_progress');
      expect(ctx.repository.getPlanTaskStats()).toMatchObject({ total: 2, inProgress: 1, completed: 1 });
      const knowledge = await add('Related knowledge');
      ctx.repository.addPlanRelation(root.id, knowledge.id, 'input');
      ctx.repository.addPlanRelation(root.id, knowledge.id, 'input');
      expect(ctx.repository.getPlanRelations(root.id)).toEqual([{ id: knowledge.id, relationType: 'input' }]);
      expect(ctx.repository.getPlansForKnowledge(knowledge.id)[0]).toMatchObject({ planId: root.id, title: 'Root' });
      expect(ctx.repository.deletePlanRelations(root.id)).toBe(1);
      expect(ctx.repository.deletePlanTask(k.id)).toBe(true);
      expect(ctx.repository.deletePlanTask(k.id)).toBe(false);
    });

    it('protects system entries from ordinary lists and exposes all rows in embedding coverage', async () => {
      ctx = makeDb();
      const normal = await add('Normal');
      const sys = await add('System', { type: 'system' });
      ctx.sqlite.prepare("INSERT INTO knowledge_entries (id, title, content, tags, type, scope, source, created_at, updated_at) VALUES ('scope-only', 'Scope', '', '[]', 'decision', 'project', 'test', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
      expect((await ctx.repository.listAll()).map(x => x.id)).toEqual(expect.arrayContaining([normal.id, 'scope-only']));
      expect((await ctx.repository.listAll()).map(x => x.id)).not.toContain(sys.id);
      expect(await ctx.repository.findById(sys.id)).not.toBeNull();
      expect(ctx.repository.embeddingCoverage()).toMatchObject({ entries: 3, entryEmbeddings: 2, missingEntries: 1 });
      expect(ctx.repository.listMissingKnowledgeEmbeddingIds().map(x => x.id)).toEqual(['scope-only']);
      expect(await ctx.repository.listScopes()).toEqual(['project']);
    });
  });
});
