import { test, expect } from '@playwright/test';
import { createTestContext, destroyTestContext, createFactory, type TestContext } from '../test-helpers.js';
import { KnowledgeType } from '@ai-knowledge/shared';
import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';

let ctx: TestContext;
let factory: ReturnType<typeof createFactory>;

test.beforeAll(() => {
  ctx = createTestContext();
  factory = createFactory(ctx.service);
});

test.afterAll(() => {
  destroyTestContext(ctx);
});

test.describe('Performance — Latency Benchmarks', () => {
  test('addKnowledge single entry < 100ms', async () => {
    const start = performance.now();
    await factory.knowledge({ content: 'Latency benchmark entry' });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test('search with 100 entries in DB < 500ms', async () => {
    for (let i = 0; i < 100; i++) {
      await factory.knowledge({ content: `Search perf entry ${i} keyword${i}` });
    }
    const start = performance.now();
    await ctx.service.search('keyword50', { threshold: 0.0, limit: 10 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  test('listRecent with 100 entries < 100ms', async () => {
    // Entries already inserted
    const start = performance.now();
    await ctx.service.listRecent(100);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test('createPlan with 20 tasks < 300ms', async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      description: `Perf task ${i}`,
    }));
    const start = performance.now();
    await factory.plan({ title: 'Perf Plan 20 Tasks', tasks });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(300);
  });

  test('listPlanTasks with 50 tasks < 100ms', async () => {
    const plan = await factory.plan({ title: 'List Tasks Perf Plan' });
    for (let i = 0; i < 50; i++) {
      ctx.service.createPlanTask({ planId: plan.id, description: `Task ${i}`, position: i });
    }
    const start = performance.now();
    ctx.service.listPlanTasks(plan.id);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test('updatePlanTask single < 50ms', async () => {
    const plan = await factory.plan({ title: 'Update Task Perf' });
    const task = ctx.service.createPlanTask({ planId: plan.id, description: 'Task to update' });
    const start = performance.now();
    ctx.service.updatePlanTask(task.id, { description: 'Updated description' });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  test('getOperationCounts < 50ms', () => {
    const start = performance.now();
    ctx.service.getOperationCounts();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

test.describe('Performance — Throughput', () => {
  test('sequential addKnowledge 50 entries < 10s', async () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      await factory.knowledge({ content: `Throughput entry ${i}` });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });

  test('sequential createPlanTask 100 tasks < 5s', async () => {
    const plan = await factory.plan({ title: 'Throughput Tasks Plan' });
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      ctx.service.createPlanTask({ planId: plan.id, description: `Throughput task ${i}`, position: i });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5_000);
  });

  test('sequential search 10 queries with 100 entries < 5s', async () => {
    // DB already has entries from previous tests
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      await ctx.service.search(`throughput query ${i}`, { threshold: 0.0, limit: 10 });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5_000);
  });
});

test.describe('Performance — Database Size', () => {
  test('DB file size < 5MB after 100 entries', async () => {
    // DB already has many entries from previous tests
    const stats = statSync(ctx.dbPath);
    const sizeMB = stats.size / (1024 * 1024);
    expect(sizeMB).toBeLessThan(5);
  });

  test('migration on fresh DB < 1000ms', () => {
    const start = performance.now();
    const freshCtx = createTestContext();
    const elapsed = performance.now() - start;
    destroyTestContext(freshCtx);
    expect(elapsed).toBeLessThan(1000);
  });
});
