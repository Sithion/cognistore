import { test, expect } from '@playwright/test';
import { createTestContext, destroyTestContext, createFactory, type TestContext } from '../test-helpers.js';
import { KnowledgeType } from '@ai-knowledge/shared';

let ctx: TestContext;
let factory: ReturnType<typeof createFactory>;

test.beforeAll(() => {
  ctx = createTestContext();
  factory = createFactory(ctx.service);
});

test.afterAll(() => {
  destroyTestContext(ctx);
});

test.describe('Load — Bulk Insert', () => {
  test('insert 100 knowledge entries sequentially', async () => {
    for (let i = 0; i < 100; i++) {
      await factory.knowledge({ content: `Bulk entry ${i} with unique text chunk${i}` });
    }
    const all = await ctx.service.listRecent(200);
    expect(all.length).toBeGreaterThanOrEqual(100);
  });

  test('insert 20 plans with 10 tasks each', async () => {
    for (let i = 0; i < 20; i++) {
      const tasks = Array.from({ length: 10 }, (_, j) => ({
        description: `Plan ${i} Task ${j}`,
      }));
      await factory.plan({ title: `Bulk Plan ${i}`, tasks });
    }
    const plans = ctx.service.listPlans(100);
    expect(plans.length).toBeGreaterThanOrEqual(20);

    for (const plan of plans.slice(0, 20)) {
      const tasks = ctx.service.listPlanTasks(plan.id);
      expect(tasks.length).toBe(10);
    }
  });

  test('insert 100 entries then search still returns results', async () => {
    // Entries already inserted from previous test
    const results = await ctx.service.search('unique text chunk', { threshold: 0.0, limit: 10 });
    expect(results.length).toBeGreaterThan(0);
  });
});

test.describe('Load — Concurrent Operations', () => {
  test('10 concurrent addKnowledge calls', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      factory.knowledge({ content: `Concurrent entry ${i} with data` })
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);
    results.forEach((r) => expect(r.id).toBeTruthy());
  });

  test('5 concurrent plan creates', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      factory.plan({ title: `Concurrent Plan ${i}`, tasks: [{ description: `Task for plan ${i}` }] })
    );
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    results.forEach((r) => expect(r.id).toBeTruthy());
  });

  test('mixed read/write: 5 searches + 5 inserts concurrently', async () => {
    const searches = Array.from({ length: 5 }, (_, i) =>
      ctx.service.search(`concurrent query ${i}`, { threshold: 0.0, limit: 5 })
    );
    const inserts = Array.from({ length: 5 }, (_, i) =>
      factory.knowledge({ content: `Mixed concurrent insert ${i}` })
    );
    const results = await Promise.all([...searches, ...inserts]);
    expect(results).toHaveLength(10);
    // No errors thrown means success
  });
});

test.describe('Load — Stress', () => {
  test('create plan with 100 tasks — all returned in correct order', async () => {
    const plan = await factory.plan({ title: 'Stress Plan 100 Tasks' });
    for (let i = 0; i < 100; i++) {
      ctx.service.createPlanTask({ planId: plan.id, description: `Stress Task ${i}`, position: i });
    }
    const tasks = ctx.service.listPlanTasks(plan.id);
    expect(tasks).toHaveLength(100);
    for (let i = 0; i < 100; i++) {
      expect(tasks[i].position).toBe(i);
    }
  });

  test('add 50 relations to one plan (25 input + 25 output)', async () => {
    const plan = await factory.plan({ title: 'Relation Stress Plan' });
    const entries: string[] = [];
    for (let i = 0; i < 50; i++) {
      const entry = await factory.knowledge({ content: `Relation entry ${i}` });
      entries.push(entry.id);
    }

    for (let i = 0; i < 25; i++) {
      ctx.service.addPlanRelation(plan.id, entries[i], 'input');
    }
    for (let i = 25; i < 50; i++) {
      ctx.service.addPlanRelation(plan.id, entries[i], 'output');
    }

    const relations = await ctx.service.getPlanRelations(plan.id);
    expect(relations).toHaveLength(50);
  });
});
