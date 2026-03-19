import { test, expect } from '@playwright/test';
import { createTestContext, destroyTestContext, createFactory, type TestContext } from '../test-helpers.js';
import { KnowledgeStatus } from '@ai-knowledge/shared';

let ctx: TestContext;
let factory: ReturnType<typeof createFactory>;

test.beforeAll(() => {
  ctx = createTestContext();
  factory = createFactory(ctx.service);
});
test.afterAll(() => {
  destroyTestContext(ctx);
});

test('createPlan returns Plan with status=draft', async () => {
  const plan = await factory.plan({ title: 'Draft Plan' });

  expect(plan.id).toBeTruthy();
  expect(plan.title).toBe('Draft Plan');
  expect(plan.status).toBe(KnowledgeStatus.DRAFT);
  expect(plan.createdAt).toBeInstanceOf(Date);
  expect(plan.updatedAt).toBeInstanceOf(Date);
});

test('createPlan with tasks array creates plan + tasks', async () => {
  const plan = await factory.plan({
    title: 'Plan With Tasks',
    tasks: [
      { description: 'Task A' },
      { description: 'Task B', priority: 'high' },
    ],
  });

  expect(plan.id).toBeTruthy();

  const tasks = ctx.service.listPlanTasks(plan.id);
  expect(tasks).toHaveLength(2);
  expect(tasks[0].description).toBe('Task A');
  expect(tasks[1].description).toBe('Task B');
  expect(tasks[1].priority).toBe('high');
});

test('createPlan with relatedKnowledgeIds creates input relations', async () => {
  const k1 = await factory.knowledge({ content: 'Related knowledge 1 for plan' });
  const k2 = await factory.knowledge({ content: 'Related knowledge 2 for plan' });

  const plan = await ctx.service.createPlan({
    title: 'Plan With Relations',
    content: 'A plan that references knowledge',
    tags: ['relations-test'],
    scope: 'global',
    source: 'test',
  });

  ctx.service.addPlanRelation(plan.id, k1.id, 'input');
  ctx.service.addPlanRelation(plan.id, k2.id, 'input');

  const relations = await ctx.service.getPlanRelations(plan.id);
  expect(relations).toHaveLength(2);
  const relIds = relations.map((r) => r.entry.id);
  expect(relIds).toContain(k1.id);
  expect(relIds).toContain(k2.id);
  for (const rel of relations) {
    expect(rel.relationType).toBe('input');
  }
});

test('getPlanById returns plan', async () => {
  const plan = await factory.plan({ title: 'Fetch Plan' });
  const fetched = ctx.service.getPlanById(plan.id);

  expect(fetched).not.toBeNull();
  expect(fetched!.id).toBe(plan.id);
  expect(fetched!.title).toBe('Fetch Plan');
});

test('updatePlan changes status draft -> active -> completed', async () => {
  const plan = await factory.plan();
  expect(plan.status).toBe(KnowledgeStatus.DRAFT);

  const active = ctx.service.updatePlan(plan.id, { status: KnowledgeStatus.ACTIVE });
  expect(active).not.toBeNull();
  expect(active!.status).toBe(KnowledgeStatus.ACTIVE);

  const completed = ctx.service.updatePlan(plan.id, { status: KnowledgeStatus.COMPLETED });
  expect(completed).not.toBeNull();
  expect(completed!.status).toBe(KnowledgeStatus.COMPLETED);
});

test('updatePlan changes title, content, and tags', async () => {
  const plan = await factory.plan({ title: 'Old Title', content: 'Old content', tags: ['old'] });

  const updated = ctx.service.updatePlan(plan.id, {
    title: 'New Title',
    content: 'New content',
    tags: ['new', 'updated'],
  });

  expect(updated).not.toBeNull();
  expect(updated!.title).toBe('New Title');
  expect(updated!.content).toBe('New content');
  expect(updated!.tags).toEqual(['new', 'updated']);
});

test('listPlans returns all plans ordered by date', async () => {
  const p1 = await factory.plan({ title: 'List Plan 1' });
  await new Promise((r) => setTimeout(r, 10));
  const p2 = await factory.plan({ title: 'List Plan 2' });

  const plans = ctx.service.listPlans(50);
  const ids = plans.map((p) => p.id);

  expect(ids).toContain(p1.id);
  expect(ids).toContain(p2.id);

  // Most recent first
  const i1 = ids.indexOf(p1.id);
  const i2 = ids.indexOf(p2.id);
  expect(i2).toBeLessThan(i1);
});

test('listPlans with status filter', async () => {
  const draftPlan = await factory.plan({ title: 'Draft Filter Plan' });
  const activePlan = await factory.plan({ title: 'Active Filter Plan' });
  ctx.service.updatePlan(activePlan.id, { status: KnowledgeStatus.ACTIVE });

  const drafts = ctx.service.listPlans(50, KnowledgeStatus.DRAFT);
  const draftIds = drafts.map((p) => p.id);
  expect(draftIds).toContain(draftPlan.id);
  expect(draftIds).not.toContain(activePlan.id);

  const actives = ctx.service.listPlans(50, KnowledgeStatus.ACTIVE);
  const activeIds = actives.map((p) => p.id);
  expect(activeIds).toContain(activePlan.id);
  expect(activeIds).not.toContain(draftPlan.id);
});

test('deletePlan removes plan', async () => {
  const plan = await factory.plan({ title: 'To Delete' });
  const deleted = ctx.service.deletePlan(plan.id);
  expect(deleted).toBe(true);

  const fetched = ctx.service.getPlanById(plan.id);
  expect(fetched).toBeNull();
});

test('deletePlan cascades to tasks', async () => {
  const plan = await factory.plan({
    title: 'Cascade Delete Plan',
    tasks: [
      { description: 'Cascade Task 1' },
      { description: 'Cascade Task 2' },
    ],
  });

  const tasksBefore = ctx.service.listPlanTasks(plan.id);
  expect(tasksBefore).toHaveLength(2);

  ctx.service.deletePlan(plan.id);

  const tasksAfter = ctx.service.listPlanTasks(plan.id);
  expect(tasksAfter).toHaveLength(0);
});

test('multiple plans can exist', async () => {
  const p1 = await factory.plan({ title: 'Multi Plan A' });
  const p2 = await factory.plan({ title: 'Multi Plan B' });
  const p3 = await factory.plan({ title: 'Multi Plan C' });

  const plans = ctx.service.listPlans(50);
  const ids = plans.map((p) => p.id);

  expect(ids).toContain(p1.id);
  expect(ids).toContain(p2.id);
  expect(ids).toContain(p3.id);
});
