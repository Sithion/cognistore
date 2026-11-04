import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from './helpers.js';

describe('KnowledgeService plans', () => {
  let ctx: ReturnType<typeof makeDb>;

  afterEach(() => {
    ctx?.service.stopPendingWriteTimers();
    ctx?.cleanup();
    vi.useRealTimers();
  });

  const planInput = (title: string, content = `Detailed work for ${title}`, scope = 'project-a') => ({
    title, content, tags: ['plans'], scope, source: 'unit',
  });

  it('creates a draft plan and persists tasks in their input order', async () => {
    ctx = makeDb();
    const plan = await ctx.service.createPlan({ ...planInput('First plan'), tasks: [
      { description: 'Inspect' }, { description: 'Implement', priority: 'high' },
    ] });
    expect(plan.status).toBe('draft');
    expect(plan.parentPlanId).toBeNull();
    expect(plan.rootPlanId).toBeNull();
    expect(ctx.service.listPlanTasks(plan.id).map((t) => [t.description, t.position, t.priority])).toEqual([
      ['Inspect', 0, 'medium'], ['Implement', 1, 'high'],
    ]);
  });

  it('deduplicates a highly similar draft, updating content and replacing tasks', async () => {
    ctx = makeDb();
    const first = await ctx.service.createPlan({ ...planInput('Configure SQLite WAL mode'), tasks: [{ description: 'Old task' }] });
    const second = await ctx.service.createPlan({ ...planInput('Configure SQLite WAL mode'), content: first.content, tasks: [{ description: 'New task' }] });
    expect(second.id).toBe(first.id);
    expect(second.deduplicated).toBe(true);
    expect(second.deduplicatedAction).toBe('draft_plan_updated');
    expect(ctx.service.listPlanTasks(first.id).map((t) => t.description)).toEqual(['New task']);
  });

  it('adds tasks without replacing content when the matching plan is active', async () => {
    ctx = makeDb();
    const first = await ctx.service.createPlan({ ...planInput('Ship the SQLite feature'), status: 'active', tasks: [{ description: 'Existing' }] });
    const merged = await ctx.service.createPlan({ ...planInput(first.title, first.content), tasks: [{ description: 'Follow up' }] });
    expect(merged.id).toBe(first.id);
    expect(merged.deduplicatedAction).toBe('tasks_added_to_active_plan');
    expect(ctx.service.listPlanTasks(first.id).map((t) => t.description)).toEqual(['Existing', 'Follow up']);
  });

  it('skipDedup always creates a separate plan', async () => {
    ctx = makeDb();
    const first = await ctx.service.createPlan(planInput('Repeatable project plan'));
    const second = await ctx.service.createPlan({ ...planInput(first.title, first.content), skipDedup: true });
    expect(second.id).not.toBe(first.id);
    expect(second.deduplicated).toBeUndefined();
  });

  it('adds tasks to a clearly matching active plan', async () => {
    ctx = makeDb();
    const first = await ctx.service.createPlan({ ...planInput('SQLite WAL mode configure database persistence safely'), status: 'active' });
    const second = await ctx.service.createPlan({ ...planInput(first.title, first.content), tasks: [{ description: 'Additional work' }] });
    expect(second.id).toBe(first.id);
    expect(second.deduplicatedAction).toBe('tasks_added_to_active_plan');
    expect(ctx.service.listPlanTasks(first.id).map((t) => t.description)).toEqual(['Additional work']);
  });

  it('resolves parent lineage and warns while creating a root for a missing parent', async () => {
    ctx = makeDb();
    const root = await ctx.service.createPlan(planInput('Root effort'));
    const child = await ctx.service.createPlan({ ...planInput('Independent child effort'), parentPlanId: root.id, skipDedup: true });
    expect(child.parentPlanId).toBe(root.id);
    expect(child.rootPlanId).toBe(root.id);
    const orphan = await ctx.service.createPlan({ ...planInput('Orphaned effort'), parentPlanId: 'missing-plan-id', skipDedup: true });
    expect(orphan.parentPlanId).toBeNull();
    expect(orphan.rootPlanId).toBeNull();
    expect(orphan.lineageWarning).toContain('does not exist');
  });

  it('archives stale drafts before attempting deduplication', async () => {
    ctx = makeDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('1970-01-02T00:00:00.000Z'));
    const stale = await ctx.service.createPlan(planInput('Stale draft plan'));
    ctx.sqlite.prepare('UPDATE plans SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', stale.id);
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    const created = await ctx.service.createPlan({ ...planInput(stale.title, stale.content), skipDedup: true });
    expect(ctx.service.getPlanById(stale.id)?.status).toBe('archived');
    expect(created.id).not.toBe(stale.id);
  });

  it('updates existing plans, completes unfinished tasks on completion, and returns null for missing ids', async () => {
    ctx = makeDb();
    const plan = await ctx.service.createPlan({ ...planInput('Update plan'), tasks: [{ description: 'One' }, { description: 'Two' }] });
    const updated = ctx.service.updatePlan(plan.id, { title: 'Renamed plan', status: 'completed' });
    expect(updated?.title).toBe('Renamed plan');
    expect(updated?.status).toBe('completed');
    expect(ctx.service.listPlanTasks(plan.id).map((t) => t.status)).toEqual(['completed', 'completed']);
    expect(ctx.service.updatePlan('missing-plan-id', { title: 'No row' })).toBeNull();
  });

  it('rejects self-parenting and descendant-parenting without applying other updates', async () => {
    ctx = makeDb();
    const root = await ctx.service.createPlan(planInput('Relink root'));
    const child = await ctx.service.createPlan({ ...planInput('Relink child'), parentPlanId: root.id, skipDedup: true });
    expect(() => ctx.service.updatePlan(root.id, { title: 'Should not persist', parentPlanId: child.id })).toThrow(/descendant/);
    expect(ctx.service.getPlanById(root.id)?.title).toBe('Relink root');
    expect(() => ctx.service.updatePlan(root.id, { parentPlanId: root.id })).toThrow(/own parent/);
  });

  it('unlinks a plan and promotes its subtree to the new root', async () => {
    ctx = makeDb();
    const root = await ctx.service.createPlan(planInput('Original root'));
    const child = await ctx.service.createPlan({ ...planInput('Middle child'), parentPlanId: root.id, skipDedup: true });
    const leaf = await ctx.service.createPlan({ ...planInput('Final leaf'), parentPlanId: child.id, skipDedup: true });
    const unlinked = ctx.service.updatePlan(child.id, { parentPlanId: null });
    expect(unlinked?.parentPlanId).toBeNull();
    expect(unlinked?.rootPlanId).toBeNull();
    expect(ctx.service.getPlanById(leaf.id)?.rootPlanId).toBe(child.id);
  });

  it('filters plans by status and scope with offset and enforces valid status names', async () => {
    ctx = makeDb();
    await ctx.service.createPlan({ ...planInput('One'), scope: 'alpha', status: 'draft', skipDedup: true } as any);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await ctx.service.createPlan({ ...planInput('Two'), scope: 'alpha', status: 'active', skipDedup: true } as any);
    await ctx.service.createPlan({ ...planInput('Three'), scope: 'beta', status: 'active', skipDedup: true } as any);
    expect(ctx.service.listPlans(10, ['active'], 'alpha').map((p) => p.title)).toEqual(['Two']);
    expect(ctx.service.listPlans(10, undefined, 'alpha', 1).map((p) => p.title)).toEqual(['One']);
    expect(() => ctx.service.listPlans(10, ['unknown'])).toThrow(/unknown plan status/);
  });

  it('adds, updates, lists and deletes plan tasks, including missing task ids', async () => {
    ctx = makeDb();
    const plan = await ctx.service.createPlan(planInput('Task operations'));
    const task = ctx.service.createPlanTask({ planId: plan.id, description: 'Draft task', notes: 'initial' });
    const updated = ctx.service.updatePlanTask(task.id, { description: 'Revised task', notes: null, position: 4 });
    expect(updated?.task.description).toBe('Revised task');
    expect(updated?.task.notes).toBeNull();
    expect(ctx.service.updatePlanTask('missing-task-id', { status: 'completed' })).toBeNull();
    expect(ctx.service.deletePlanTask(task.id).deleted).toBe(true);
    expect(ctx.service.deletePlanTask(task.id).deleted).toBe(false);
    expect(ctx.service.listPlanTasks(plan.id)).toEqual([]);
  });

  it('auto-activates on first in-progress task and auto-completes when all tasks finish', async () => {
    ctx = makeDb();
    const plan = await ctx.service.createPlan({ ...planInput('Task lifecycle'), tasks: [{ description: 'A' }, { description: 'B' }] });
    const [a, b] = ctx.service.listPlanTasks(plan.id);
    const started = ctx.service.updatePlanTask(a.id, { status: 'in_progress' });
    expect(started?.planStatus).toBe('active');
    expect(started?.autoActions).toContain('Plan auto-activated from draft to active');
    ctx.service.updatePlanTask(a.id, { status: 'completed' });
    const finished = ctx.service.updatePlanTask(b.id, { status: 'completed' });
    expect(finished?.planStatus).toBe('completed');
    expect(finished?.progress).toBe('2/2 completed');
    expect(finished?.autoActions).toContain('Plan auto-completed — all tasks done');
  });

  it('does not auto-complete a plan when deleting its last task', async () => {
    ctx = makeDb();
    const plan = await ctx.service.createPlan({ ...planInput('Keep empty active'), status: 'active', tasks: [{ description: 'Only task', status: 'completed' } as any] });
    const task = ctx.service.listPlanTasks(plan.id)[0];
    const result = ctx.service.deletePlanTask(task.id);
    expect(result.planStatus).toBe('active');
    expect(result.autoActions).toEqual([]);
  });

  it('returns a root-first chain for any member and null for an unknown plan', async () => {
    ctx = makeDb();
    const root = await ctx.service.createPlan(planInput('Chain root'));
    const child = await ctx.service.createPlan({ ...planInput('Chain child'), parentPlanId: root.id, skipDedup: true });
    const chain = ctx.service.getPlanChain(child.id);
    expect(chain?.rootPlanId).toBe(root.id);
    expect(chain?.chain.map((item) => [item.id, item.depth, item.isCurrent])).toEqual([[root.id, 0, false], [child.id, 1, true]]);
    expect(ctx.service.getPlanChain('missing-plan-id')).toBeNull();
  });

  it('links knowledge as input and output and finds its related plans', async () => {
    ctx = makeDb();
    const plan = await ctx.service.createPlan(planInput('Knowledge relations'));
    const entry = await ctx.service.add({ title: 'Related note', content: 'Plan context', tags: [], type: 'note' as any, scope: 'project-a', source: 'unit', skipDedup: true });
    ctx.service.addPlanRelation(plan.id, entry.id, 'input');
    ctx.service.addPlanRelation(plan.id, entry.id, 'output');
    expect((await ctx.service.getPlanRelations(plan.id)).map((r) => r.relationType)).toEqual(['input', 'output']);
    expect(ctx.service.getPlansForKnowledge(entry.id).map((r) => [r.planId, r.relationType, r.title])).toEqual([
      [plan.id, 'input', plan.title], [plan.id, 'output', plan.title],
    ]);
  });

  it('imports plans with tasks, skips title/content duplicates, and clears foreign lineage', async () => {
    ctx = makeDb();
    const result = await ctx.service.importPlans([
      { ...planInput('Imported plan'), parentPlanId: 'foreign-parent', rootPlanId: 'foreign-root', tasks: [{ description: 'Imported task', status: 'in_progress', notes: 'kept' }] } as any,
      { ...planInput('Imported plan'), parentPlanId: 'another-foreign-parent' } as any,
    ]);
    expect(result).toEqual({ imported: 1, skipped: 1, errors: [] });
    const imported = ctx.service.listAllPlans()[0];
    expect(imported.parentPlanId).toBeNull();
    expect(imported.rootPlanId).toBeNull();
    expect(ctx.service.listPlanTasks(imported.id).map((t) => [t.status, t.notes])).toEqual([['in_progress', 'kept']]);
  });

  it('removes old completed plan embeddings but retains recent and draft vectors', async () => {
    ctx = makeDb();
    const oldDone = await ctx.service.createPlan({ ...planInput('Old completed plan'), status: 'completed', skipDedup: true } as any);
    const oldDraft = await ctx.service.createPlan({ ...planInput('Old draft plan'), skipDedup: true });
    const recentDone = await ctx.service.createPlan({ ...planInput('Recent completed plan'), status: 'completed', skipDedup: true } as any);
    ctx.sqlite.prepare('UPDATE plans SET updated_at = ? WHERE id IN (?, ?)').run('2020-01-01T00:00:00.000Z', oldDone.id, oldDraft.id);
    expect(ctx.service.cleanupCompletedPlanEmbeddings(30)).toBe(1);
    const remaining = ctx.sqlite.prepare('SELECT id FROM plans_embeddings ORDER BY id').all().map((row: any) => row.id);
    expect(remaining).toContain(oldDraft.id);
    expect(remaining).toContain(recentDone.id);
    expect(remaining).not.toContain(oldDone.id);
  });
});
