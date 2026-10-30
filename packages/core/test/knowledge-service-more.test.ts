import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeService } from '../src/services/knowledge.service.js';
import { makeDb, stubEmbedding } from './helpers.js';

const input = (title: string, overrides: Record<string, unknown> = {}) => ({
  title, content: `Content for ${title} with distinctive details`, tags: [], type: 'fact' as any,
  scope: 'global', source: 'unit', skipDedup: true, ...overrides,
});

describe('KnowledgeService additional coverage', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => { ctx?.service.stopPendingWriteTimers(); ctx?.cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('lists tags and top tags with ranges, excluding system entries', async () => {
    ctx = makeDb();
    await ctx.service.add(input('Tag one', { tags: ['alpha', 'common'] }));
    await ctx.service.add(input('Tag two', { tags: ['beta', 'common'] }));
    await ctx.service.add(input('System tag', { type: 'system', tags: ['hidden'] }));
    ctx.sqlite.prepare("UPDATE knowledge_entries SET created_at = CASE title WHEN 'Tag one' THEN '2025-01-01T00:00:00.000Z' ELSE '2026-01-01T00:00:00.000Z' END").run();
    expect(new Set(await ctx.service.listTags())).toEqual(new Set(['alpha', 'beta', 'common']));
    expect(await ctx.service.topTags(1)).toEqual([{ tag: 'common', count: 2 }]);
    expect(await ctx.service.listTags({ from: '2024-12-31', to: '2025-12-31' })).toEqual(expect.arrayContaining(['alpha', 'common']));
    expect(await ctx.service.topTags(10, { from: '2024-12-31', to: '2025-12-31' })).toEqual(expect.arrayContaining([{ tag: 'alpha', count: 1 }]));
  });

  it('suggests near-duplicate tags using normalized edit and token similarity thresholds', async () => {
    ctx = makeDb();
    await ctx.service.add(input('Tags a', { tags: ['redis', 'rediss', 'nest.js'] }));
    await ctx.service.add(input('Tags b', { tags: ['nestjs', 'postgres'] }));
    const suggestions = await ctx.service.suggestTagMerges(0.8);
    expect(suggestions.some((p) => new Set([p.a, p.b]).has('nest.js') && new Set([p.a, p.b]).has('nestjs'))).toBe(true);
    expect(suggestions.some((p) => p.a === 'redis' && p.b === 'rediss')).toBe(true);
    expect((await ctx.service.suggestTagMerges(1.01))).toEqual([]);
  });

  it('lists scopes and recent entries with filters, offset, and excludes systems', async () => {
    ctx = makeDb();
    await ctx.service.add(input('Recent one', { scope: 'alpha', tags: ['x'], agentId: 'agent-a', platform: 'vscode' }));
    await ctx.service.add(input('Recent two', { scope: 'alpha', tags: ['y'], agentId: 'agent-b', platform: 'vscode' }));
    await ctx.service.add(input('Recent three', { scope: 'beta', tags: ['x'], agentId: null, platform: null }));
    await ctx.service.add(input('System recent', { type: 'system', scope: 'system-scope' }));
    ctx.sqlite.prepare('UPDATE knowledge_entries SET created_at = ? WHERE title = ?').run('2026-01-01T00:00:00.000Z', 'Recent one');
    ctx.sqlite.prepare('UPDATE knowledge_entries SET created_at = ? WHERE title = ?').run('2025-01-01T00:00:00.000Z', 'Recent two');
    expect(new Set(await ctx.service.listScopes())).toEqual(new Set(['alpha', 'beta', 'system-scope']));
    const all = await ctx.service.listRecent(10);
    expect(all.map((e) => e.title)).not.toContain('System recent');
    const page = await ctx.service.listRecent(1, { scope: 'alpha' }, 1);
    expect(page).toHaveLength(1);
    expect(page[0].title).toBe('Recent two');
    expect((await ctx.service.listRecent(10, { tags: ['x', 'y'], agent: 'unspecified', platform: 'unknown' })).map((e) => e.title)).toEqual(['Recent three']);
    expect(await ctx.service.listRecent(10, { platform: 'vscode', agent: 'agent-a', type: 'fact' })).toHaveLength(1);
  });

  it('lists all non-system entries and handles search empty, embedding failure, and federation fallback', async () => {
    ctx = makeDb();
    await ctx.service.add(input('Visible item'));
    await ctx.service.add(input('Hidden system', { type: 'system' }));
    expect((await ctx.service.listAll()).map((e) => e.title)).toEqual(['Visible item']);
    expect(await ctx.service.search('unmatched query', { limit: 0 })).toEqual([]);
    const federated = await ctx.service.searchFederated('Visible item');
    expect(federated.local.length).toBeGreaterThan(0);
    expect(federated.external).toEqual([]);
    const failing = new KnowledgeService(ctx.repository, { async embed() { throw new Error('embed down'); } });
    await expect(failing.search('anything')).rejects.toThrow('embed down');
  });

  it('appends plan-linked knowledge after direct hits with provenance, and can disable context', async () => {
    ctx = makeDb();
    const direct = await ctx.service.add(input('Direct sqlite WAL transaction planning result')); 
    const linked = await ctx.service.add(input('Plan related transaction locking', { content: 'A result associated with planning transactions.' }));
    const plan = await ctx.service.createPlan({ title: 'sqlite WAL transaction planning', content: 'Plan sqlite WAL transaction planning', tags: ['plan'], scope: 'global', source: 'unit', skipDedup: true });
    ctx.service.addPlanRelation(plan.id, linked.id, 'output');
    const withContext = await ctx.service.search('sqlite WAL transaction planning', { threshold: 0, limit: 1, includePlanContext: true });
    const extra = withContext.find((r) => r.entry.id === linked.id);
    expect(withContext.findIndex((r) => r.entry.id === direct.id)).toBeLessThan(withContext.findIndex((r) => r.entry.id === linked.id));
    expect(extra?.provenance?.viaPlanId).toBe(plan.id);
    const withoutContext = await ctx.service.search('sqlite WAL transaction planning', { threshold: 0, limit: 1, includePlanContext: false });
    expect(withoutContext.some((r) => r.entry.id === linked.id)).toBe(false);
  });

  it('re-embeds entries and plans, resumes missing embeddings after a per-item failure', async () => {
    ctx = makeDb();
    const ok = await ctx.service.add(input('Success row'));
    const failed = await ctx.service.add(input('FAIL row'));
    const plan = await ctx.service.createPlan({ title: 'Backfill plan', content: 'plan body', tags: [], scope: 'global', source: 'unit', skipDedup: true });
    expect(await ctx.service.reembedAll()).toBe(3);
    ctx.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id IN (?, ?)').run(ok.id, failed.id);
    const resumable = new KnowledgeService(ctx.repository, { async embed(t) { if (t.includes('FAIL')) throw new Error('down'); return stubEmbedding(t); } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await resumable.embedMissing()).toEqual({ embedded: 1, failed: 1, remaining: 1, cancelled: false });
    expect(await resumable.embedMissing()).toEqual({ embedded: 0, failed: 1, remaining: 1, cancelled: false });
    expect(warn).toHaveBeenCalled();
    expect(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM plans_embeddings WHERE id = ?').get(plan.id)).toEqual({ n: 1 });
  });

  it('returns stats and grouped counts for entry provenance and plans', async () => {
    ctx = makeDb();
    const now = new Date().toISOString();
    await ctx.service.add(input('Stats a', { type: 'fact', scope: 'one', agentId: 'a', platform: 'vscode' }));
    await ctx.service.add(input('Stats b', { type: 'pattern', scope: 'two', agentId: null, platform: null }));
    const plan = await ctx.service.createPlan({ title: 'Stats plan', content: 'plan', tags: [], scope: 'one', source: 'unit', skipDedup: true, tasks: [{ description: 'pending' }, { description: 'progress', priority: 'high' }] });
    const tasks = ctx.service.listPlanTasks(plan.id);
    ctx.service.updatePlanTask(tasks[1].id, { status: 'in_progress' });
    const stats = await ctx.service.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byType).toEqual(expect.arrayContaining([{ type: 'fact', count: 1 }, { type: 'pattern', count: 1 }]));
    expect((await ctx.service.countByScope()).length).toBe(2);
    expect(await ctx.service.countByAgent()).toEqual(expect.arrayContaining([{ agent: 'a', count: 1 }, { agent: 'unspecified', count: 1 }]));
    expect(await ctx.service.countByPlatform()).toEqual(expect.arrayContaining([{ platform: 'vscode', count: 1 }, { platform: 'unknown', count: 1 }]));
    expect((await ctx.service.countByType({ from: now.slice(0, 10), to: '2999-01-01' })).length).toBeGreaterThan(0);
    expect(ctx.service.getPlanTaskStats()).toMatchObject({ total: 2, pending: 1, inProgress: 1, completed: 0 });
  });

  it('flushes operations before metrics, reconciles rollups, and cleans old rows', async () => {
    ctx = makeDb();
    await ctx.service.search('no results');
    expect(ctx.service.getOperationCounts().readsLastDay).toBeGreaterThanOrEqual(1);
    const byDay = ctx.service.getOperationsByDay(3);
    expect(byDay).toHaveLength(3);
    expect(byDay.some((d) => d.reads >= 1)).toBe(true);
    expect(ctx.service.getPlansByDay(2)).toHaveLength(2);
    expect(ctx.service.reconcileOperationsDaily()).toBeGreaterThanOrEqual(0);
    ctx.sqlite.prepare("INSERT INTO operations_log (operation, created_at) VALUES ('read', '2020-01-01T00:00:00.000Z')").run();
    expect(ctx.service.cleanupOldOperations()).toBeGreaterThanOrEqual(1);
    await ctx.service.search('another query');
    ctx.service.flushOperations();
    expect(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM operations_log WHERE operation = 'read'").get()).toMatchObject({ n: 2 });
  });

  it('finds stale entries and duplicate pairs and groups with limits', async () => {
    ctx = makeDb();
    const old = await ctx.service.add(input('Old reference', { confidenceScore: 0.4 }));
    await ctx.service.add(input('Old reference copy', { content: 'Content for Old reference with distinctive details', confidenceScore: 0.4 }));
    ctx.sqlite.prepare("UPDATE knowledge_entries SET updated_at = '2020-01-01T00:00:00.000Z'").run();
    expect((await ctx.service.findStaleEntries({ days: 1, limit: 1 })).map((e) => e.id)).toEqual([old.id]);
    expect(await ctx.service.findDuplicatePairs({ threshold: 0.5, limit: 1 })).toHaveLength(1);
    expect(await ctx.service.findDuplicateGroups({ threshold: 0.5 })).toHaveLength(1);
  });

  it('reports unread gate reasons and applies cleanup action error branches', async () => {
    ctx = makeDb();
    const unread = await ctx.service.add(input('Old unread entry'));
    const deprecated = await ctx.service.add(input('Deprecated entry', { tags: ['deprecated'] }));
    ctx.sqlite.prepare("UPDATE cleanup_meta SET value = '2020-01-01T00:00:00.000Z' WHERE key = 'read_tracking_since'").run();
    const { report } = await ctx.service.generateCleanupReport({ unreadDays: 30 });
    expect(report.stats.unreadGate).toMatch(/no reads have ever been recorded/);
    ctx.sqlite.prepare("UPDATE knowledge_entries SET last_read_at = '2026-10-28T00:00:00.000Z' WHERE id = ?").run(deprecated.id);
    ctx.sqlite.prepare("UPDATE cleanup_meta SET value = '2020-01-01T00:00:00.000Z' WHERE key = 'read_tracking_since'").run();
    ctx.sqlite.prepare("UPDATE knowledge_entries SET created_at = '2020-01-01T00:00:00.000Z', last_read_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(unread.id);
    // The first open report is intentionally idempotent; close it before generating the now-eligible unread report.
    ctx.service.closeCleanupReport(report.id, { reviewed: false });
    const next = await ctx.service.generateCleanupReport({ unreadDays: 30 });
    expect(next.report.stats.counts).toMatchObject({ unread: 1, deprecated: 1 });
    const unreadCandidate = ctx.service.getLatestCleanupReport()!.candidates.find((c) => c.category === 'unread')!;
    ctx.sqlite.prepare("UPDATE knowledge_entries SET last_read_at = ? WHERE id = ?").run(new Date().toISOString(), unread.id);
    expect(await ctx.service.applyRemovalCandidate(unreadCandidate.id)).toMatchObject({ deleted: 0, skipped: 1 });
    const deprecatedCandidate = ctx.service.getLatestCleanupReport()!.candidates.find((c) => c.category === 'deprecated')!;
    await expect(ctx.service.applyConsolidationCandidate(deprecatedCandidate.id, { title: 'x', content: 'y' })).rejects.toThrow('cannot handle category');
    await expect(ctx.service.applyRemovalCandidate(deprecatedCandidate.id)).resolves.toMatchObject({ deleted: 1 });
    await expect(ctx.service.applyRemovalCandidate(deprecatedCandidate.id)).rejects.toThrow('not pending');
  });

  it('applies consolidation candidates and rejects stale or malformed drafts', async () => {
    ctx = makeDb();
    const a = await ctx.service.add(input('Duplicate canonical', { content: 'Shared duplicate material alpha beta gamma' }));
    await ctx.service.add(input('Duplicate copy', { content: 'Shared duplicate material alpha beta gamma' }));
    const { report } = await ctx.service.generateCleanupReport({ dupThreshold: 0.5 });
    const candidate = ctx.service.getLatestCleanupReport()!.candidates.find((c) => c.category === 'duplicate_group')!;
    await expect(ctx.service.applyConsolidationCandidate(candidate.id, { title: '', content: '' })).rejects.toThrow();
    expect(await ctx.service.applyConsolidationCandidate(candidate.id, { title: 'Consolidated', content: 'A clean combined explanation.' })).toMatchObject({ canonicalId: expect.any(String), deleted: 1 });
    expect(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM knowledge_entries WHERE id = ?').get(a.id)).toEqual({ n: 0 });
    expect(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM knowledge_entries WHERE title = ?').get('Consolidated')).toEqual({ n: 1 });
    expect(ctx.service.closeCleanupReport(report.id, { reviewed: true }).removed).toBe(1);
  });

  it('walks multi-level plan lineage, repairs deletion, archives stale drafts, and links deduplicated plans', async () => {
    ctx = makeDb();
    const create = (title: string, parentPlanId?: string) => ctx.service.createPlan({ title, content: `Detailed work for ${title}`, tags: [], scope: 'project-chain', source: 'unit', skipDedup: true, ...(parentPlanId ? { parentPlanId } : {}) });
    const root = await create('Chain root');
    const middle = await create('Chain middle', root.id);
    const leaf = await create('Chain leaf', middle.id);
    expect(ctx.service.getPlanChain(leaf.id)?.chain.map((p) => p.id)).toEqual([root.id, middle.id, leaf.id]);
    expect(ctx.service.getPlanChain('missing')).toBeNull();
    expect(ctx.service.deletePlan(middle.id)).toBe(true);
    expect(ctx.service.getPlanById(leaf.id)?.parentPlanId).toBe(root.id);
    expect(ctx.service.deletePlan('missing')).toBe(false);
    ctx.sqlite.prepare("UPDATE plans SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(leaf.id);
    expect(ctx.service.archiveStaleDrafts(24)).toBeGreaterThanOrEqual(1);
    const parent = await create('Link parent');
    const target = await ctx.service.createPlan({ title: 'Mergeable plan', content: 'Detailed work for Mergeable plan', tags: [], scope: 'project-chain', source: 'unit', skipDedup: true });
    const merged = await ctx.service.createPlan({ title: target.title, content: target.content, tags: [], scope: 'project-chain', source: 'unit', parentPlanId: parent.id });
    expect(merged.id).toBe(target.id);
    expect(ctx.service.getPlanById(target.id)?.parentPlanId).toBe(parent.id);
  });
});
