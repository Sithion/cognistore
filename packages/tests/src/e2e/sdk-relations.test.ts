import { test, expect } from '@playwright/test';
import { createTestContext, destroyTestContext, createFactory, type TestContext } from '../test-helpers.js';

let ctx: TestContext;
let factory: ReturnType<typeof createFactory>;

test.beforeAll(() => {
  ctx = createTestContext();
  factory = createFactory(ctx.service);
});
test.afterAll(() => {
  destroyTestContext(ctx);
});

test('addPlanRelation creates input relation', async () => {
  const plan = await factory.plan({ title: 'Input Relation Plan' });
  const knowledge = await factory.knowledge({ content: 'Input knowledge entry' });

  ctx.service.addPlanRelation(plan.id, knowledge.id, 'input');

  const relations = await ctx.service.getPlanRelations(plan.id);
  expect(relations).toHaveLength(1);
  expect(relations[0].entry.id).toBe(knowledge.id);
  expect(relations[0].relationType).toBe('input');
});

test('addPlanRelation creates output relation', async () => {
  const plan = await factory.plan({ title: 'Output Relation Plan' });
  const knowledge = await factory.knowledge({ content: 'Output knowledge entry' });

  ctx.service.addPlanRelation(plan.id, knowledge.id, 'output');

  const relations = await ctx.service.getPlanRelations(plan.id);
  expect(relations).toHaveLength(1);
  expect(relations[0].entry.id).toBe(knowledge.id);
  expect(relations[0].relationType).toBe('output');
});

test('getPlanRelations returns entries with correct relationType', async () => {
  const plan = await factory.plan({ title: 'Mixed Relations Plan' });
  const k1 = await factory.knowledge({ content: 'Input relation knowledge' });
  const k2 = await factory.knowledge({ content: 'Output relation knowledge' });

  ctx.service.addPlanRelation(plan.id, k1.id, 'input');
  ctx.service.addPlanRelation(plan.id, k2.id, 'output');

  const relations = await ctx.service.getPlanRelations(plan.id);
  expect(relations).toHaveLength(2);

  const inputRel = relations.find((r) => r.entry.id === k1.id);
  const outputRel = relations.find((r) => r.entry.id === k2.id);

  expect(inputRel).toBeDefined();
  expect(inputRel!.relationType).toBe('input');
  expect(outputRel).toBeDefined();
  expect(outputRel!.relationType).toBe('output');
});

test('duplicate relation is ignored (same plan + knowledge + type)', async () => {
  const plan = await factory.plan({ title: 'Duplicate Relation Plan' });
  const knowledge = await factory.knowledge({ content: 'Duplicate test knowledge' });

  ctx.service.addPlanRelation(plan.id, knowledge.id, 'input');
  // Adding the same relation again should not throw (INSERT OR IGNORE)
  ctx.service.addPlanRelation(plan.id, knowledge.id, 'input');

  const relations = await ctx.service.getPlanRelations(plan.id);
  expect(relations).toHaveLength(1);
});

test('different relation types for same pair both work', async () => {
  const plan = await factory.plan({ title: 'Dual Relation Plan' });
  const knowledge = await factory.knowledge({ content: 'Dual relation knowledge' });

  ctx.service.addPlanRelation(plan.id, knowledge.id, 'input');
  ctx.service.addPlanRelation(plan.id, knowledge.id, 'output');

  const relations = await ctx.service.getPlanRelations(plan.id);
  expect(relations).toHaveLength(2);

  const types = relations.map((r) => r.relationType).sort();
  expect(types).toEqual(['input', 'output']);
});
