import { test, expect } from '@playwright/test';
import { createTestContext, destroyTestContext, createFactory, type TestContext } from '../test-helpers.js';
import { TaskStatus, TaskPriority } from '@ai-knowledge/shared';

let ctx: TestContext;
let factory: ReturnType<typeof createFactory>;

test.beforeAll(() => {
  ctx = createTestContext();
  factory = createFactory(ctx.service);
});
test.afterAll(() => {
  destroyTestContext(ctx);
});

test('createPlanTask auto-calculates position', async () => {
  const plan = await factory.plan({ title: 'Position Test Plan' });

  const t1 = factory.planTask(plan.id, { description: 'First task' });
  const t2 = factory.planTask(plan.id, { description: 'Second task' });
  const t3 = factory.planTask(plan.id, { description: 'Third task' });

  expect(t1.position).toBe(0);
  expect(t2.position).toBe(1);
  expect(t3.position).toBe(2);
});

test('createPlanTask with priority=high', async () => {
  const plan = await factory.plan({ title: 'Priority Test Plan' });

  const task = factory.planTask(plan.id, { description: 'High priority task', priority: 'high' });

  expect(task.priority).toBe(TaskPriority.HIGH);
  expect(task.description).toBe('High priority task');
  expect(task.status).toBe(TaskStatus.PENDING);
});

test('updatePlanTask changes status pending -> in_progress -> completed', async () => {
  const plan = await factory.plan({ title: 'Status Transition Plan' });
  const task = factory.planTask(plan.id, { description: 'Status task' });
  expect(task.status).toBe(TaskStatus.PENDING);

  const inProgress = ctx.service.updatePlanTask(task.id, { status: TaskStatus.IN_PROGRESS });
  expect(inProgress).not.toBeNull();
  expect(inProgress!.status).toBe(TaskStatus.IN_PROGRESS);

  const completed = ctx.service.updatePlanTask(task.id, { status: TaskStatus.COMPLETED });
  expect(completed).not.toBeNull();
  expect(completed!.status).toBe(TaskStatus.COMPLETED);
});

test('updatePlanTask adds notes', async () => {
  const plan = await factory.plan({ title: 'Notes Test Plan' });
  const task = factory.planTask(plan.id, { description: 'Notes task' });
  expect(task.notes).toBeNull();

  const updated = ctx.service.updatePlanTask(task.id, { notes: 'Some important notes here' });
  expect(updated).not.toBeNull();
  expect(updated!.notes).toBe('Some important notes here');
});

test('updatePlanTask changes priority', async () => {
  const plan = await factory.plan({ title: 'Priority Change Plan' });
  const task = factory.planTask(plan.id, { description: 'Priority change task' });
  expect(task.priority).toBe(TaskPriority.MEDIUM);

  const updated = ctx.service.updatePlanTask(task.id, { priority: TaskPriority.LOW });
  expect(updated).not.toBeNull();
  expect(updated!.priority).toBe(TaskPriority.LOW);
});

test('listPlanTasks returns ordered by position', async () => {
  const plan = await factory.plan({ title: 'Order Test Plan' });

  factory.planTask(plan.id, { description: 'Task at pos 0' });
  factory.planTask(plan.id, { description: 'Task at pos 1' });
  factory.planTask(plan.id, { description: 'Task at pos 2' });

  const tasks = ctx.service.listPlanTasks(plan.id);
  expect(tasks).toHaveLength(3);
  expect(tasks[0].position).toBe(0);
  expect(tasks[1].position).toBe(1);
  expect(tasks[2].position).toBe(2);
  expect(tasks[0].description).toBe('Task at pos 0');
  expect(tasks[1].description).toBe('Task at pos 1');
  expect(tasks[2].description).toBe('Task at pos 2');
});

test('deletePlanTask works', async () => {
  const plan = await factory.plan({ title: 'Delete Task Plan' });
  const task = factory.planTask(plan.id, { description: 'Doomed task' });

  const deleted = ctx.service.deletePlanTask(task.id);
  expect(deleted).toBe(true);

  const tasks = ctx.service.listPlanTasks(plan.id);
  expect(tasks.find((t) => t.id === task.id)).toBeUndefined();
});

test('getPlanTaskStats returns correct counts', async () => {
  const plan = await factory.plan({ title: 'Stats Test Plan' });

  const t1 = factory.planTask(plan.id, { description: 'Pending task 1' });
  const t2 = factory.planTask(plan.id, { description: 'Pending task 2' });
  const t3 = factory.planTask(plan.id, { description: 'Pending task 3' });
  const t4 = factory.planTask(plan.id, { description: 'Pending task 4' });

  // Move some tasks to different statuses
  ctx.service.updatePlanTask(t2.id, { status: TaskStatus.IN_PROGRESS });
  ctx.service.updatePlanTask(t3.id, { status: TaskStatus.COMPLETED });
  ctx.service.updatePlanTask(t4.id, { status: TaskStatus.COMPLETED });

  const stats = ctx.service.getPlanTaskStats();
  // Stats are global across all plans, but we can verify the totals include our tasks
  expect(stats.total).toBeGreaterThanOrEqual(4);
  expect(stats.pending).toBeGreaterThanOrEqual(1);
  expect(stats.inProgress).toBeGreaterThanOrEqual(1);
  expect(stats.completed).toBeGreaterThanOrEqual(2);
});

test('stats update correctly as tasks change status', async () => {
  const plan = await factory.plan({ title: 'Stats Update Plan' });
  const task = factory.planTask(plan.id, { description: 'Tracking task' });

  const statsBefore = ctx.service.getPlanTaskStats();

  ctx.service.updatePlanTask(task.id, { status: TaskStatus.IN_PROGRESS });
  const statsAfterProgress = ctx.service.getPlanTaskStats();
  expect(statsAfterProgress.inProgress).toBe(statsBefore.inProgress + 1);
  expect(statsAfterProgress.pending).toBe(statsBefore.pending - 1);

  ctx.service.updatePlanTask(task.id, { status: TaskStatus.COMPLETED });
  const statsAfterComplete = ctx.service.getPlanTaskStats();
  expect(statsAfterComplete.completed).toBe(statsBefore.completed + 1);
  expect(statsAfterComplete.inProgress).toBe(statsBefore.inProgress);
});
