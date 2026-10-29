import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleLaunch, callJson, connectMcp, MCP_ENTRY } from '../mcp-helpers.js';
import { startMockOllama } from '../sidecar-helpers.js';

test('MCP bundle exercises health, token usage, plans and task error paths', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cognistore-mcp-bundle-tools-'));
  const mock = await startMockOllama('nomic-embed-text');
  let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
  try {
    client = await connectMcp(bundleLaunch(MCP_ENTRY), {
      HOME: home,
      SQLITE_PATH: join(home, 'knowledge.db'),
      COGNISTORE_HOME: join(home, '.cognistore'),
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: 'nomic-embed-text',
      COGNISTORE_PLATFORM: 'claude-code',
    });

    const health = await callJson(client, 'healthCheck');
    expect(health.isError).toBe(false);
    expect(health.body).toMatchObject({ database: { connected: true }, ollama: { connected: true } });

    const knowledgeWrite = await callJson(client, 'addKnowledge', { entries: [
      { title: 'Bundle fact one', content: 'First MCP bundle knowledge item.', tags: ['bundle', 'integration'], type: 'pattern', scope: 'workspace:mcp-bundle-tools', source: 'mcp-bundle-tools.test', agentId: ' test-agent ' },
      { title: 'Bundle fact two', content: 'Second MCP bundle knowledge item.', tags: ['bundle'], type: 'fix', scope: 'workspace:mcp-bundle-tools', source: 'mcp-bundle-tools.test' },
    ] });
    expect(knowledgeWrite.isError).toBe(false);
    const written = knowledgeWrite.body as { created: number; entries: { entry: { id: string } }[] };
    expect(written.created).toBe(2);
    const knowledgeId = written.entries[0].entry.id;
    const search = await callJson(client, 'getKnowledge', { query: 'First MCP bundle knowledge item', scope: 'workspace:mcp-bundle-tools', tags: ['bundle'], limit: 5, threshold: 0 });
    expect(search.isError).toBe(false);
    expect(JSON.stringify(search.body)).toContain(knowledgeId);
    const filteredSearch = await callJson(client, 'getKnowledge', { query: 'Second MCP bundle knowledge item', scope: 'workspace:mcp-bundle-tools', tags: ['bundle'], type: 'fix', limit: 2, threshold: 0, includePlanContext: false });
    expect(filteredSearch.isError).toBe(false);
    expect(JSON.stringify(filteredSearch.body)).toContain('Bundle fact two');
    const tags = await callJson(client, 'listTags');
    expect(tags.body).toEqual(expect.arrayContaining(['bundle', 'integration']));
    const changedKnowledge = await callJson(client, 'updateKnowledge', { id: knowledgeId, title: 'Bundle fact updated', confidenceScore: 0.8 });
    expect(changedKnowledge.isError).toBe(false);
    expect(JSON.stringify(changedKnowledge.body)).toContain('Bundle fact updated');
    const linkedWrite = await callJson(client, 'addKnowledge', { entries: {
      title: 'Plan output fact', content: 'Linked to the integration plan.', tags: ['bundle'], type: 'decision', scope: 'workspace:mcp-bundle-tools', source: 'mcp-bundle-tools.test', planId: 'not-a-real-plan',
    } });
    expect(linkedWrite.isError).toBe(false);
    expect(linkedWrite.body).toMatchObject({ linked: false, planId: 'not-a-real-plan' });
    const absentKnowledge = await callJson(client, 'updateKnowledge', { id: 'missing-entry', title: 'Missing' });
    expect(absentKnowledge.body).toEqual({ error: 'not_found', type: 'knowledge_entry', id: 'missing-entry' });

    const usage = await callJson(client, 'getTokenUsage', {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
      source: 'claude-code',
      model: 'test-model',
      project: 'bundle-tools',
    });
    expect(usage.isError).toBe(false);
    expect(usage.body).toBeTruthy();

    const created = await callJson(client, 'createPlan', {
      title: 'Bundle integration plan',
      content: 'Exercise the MCP bundle plan and task tools.',
      tags: ['integration'],
      scope: 'workspace:mcp-bundle-tools',
      source: 'mcp-bundle-tools.test',
      tasks: [{ description: 'Start the task', priority: 'high' }, { description: 'Finish the task' }],
    });
    expect(created.isError).toBe(false);
    const plan = created.body as { id: string; planFileWarning?: string; lineageHint?: string };
    expect(plan.id).toBeTruthy();
    expect(plan.planFileWarning).toContain('No planFilePath');
    expect(plan.lineageHint).toContain('ORIGINAL');

    const listed = await callJson(client, 'listPlanTasks', { planId: plan.id });
    expect(listed.body).toMatchObject({ progress: '0/2 completed' });
    const tasks = (listed.body as { tasks: { id: string }[] }).tasks;
    expect(tasks).toHaveLength(2);

    const plans = await callJson(client, 'listPlans', { limit: 10, status: 'draft', scope: 'workspace:mcp-bundle-tools' });
    expect(plans.isError).toBe(false);
    expect((plans.body as { plans: { id: string; isOriginal: boolean }[] }).plans).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: plan.id, isOriginal: true })]),
    );
    const chainResult = await callJson(client, 'getPlanChain', { planId: plan.id });
    expect(chainResult.body).toMatchObject({ total: 1, original: { id: plan.id } });
    const relation = await callJson(client, 'addPlanRelation', { planId: plan.id, knowledgeId, relationType: 'input' });
    expect(relation.body).toMatchObject({ success: true, relationType: 'input' });
    const missingRelation = await callJson(client, 'addPlanRelation', { planId: plan.id, knowledgeId: 'not-a-uuid', relationType: 'output' });
    expect(missingRelation.isError).toBe(true);
    expect(missingRelation.body).toMatchObject({ error: 'link_failed', knowledgeId: 'not-a-uuid' });
    const healthAfterMissingRelation = await callJson(client, 'healthCheck');
    expect(healthAfterMissingRelation.isError).toBe(false);
    expect(healthAfterMissingRelation.body).toMatchObject({ database: { connected: true }, ollama: { connected: true } });

    const addedTask = await callJson(client, 'addPlanTask', { planId: plan.id, description: 'Remove this extra task', priority: 'low', notes: 'Temporary' });
    expect(addedTask.isError).toBe(false);
    const extraTaskId = (addedTask.body as { id: string }).id;
    const removedTask = await callJson(client, 'deletePlanTask', { taskId: extraTaskId });
    expect(removedTask.body).toMatchObject({ deleted: true, id: extraTaskId, plan: { id: plan.id } });

    const updatedPlan = await callJson(client, 'updatePlan', { planId: plan.id, title: 'Updated bundle plan', planFilePath: '/tmp/mcp-bundle-plan.md' });
    expect(updatedPlan.isError).toBe(false);
    expect(updatedPlan.body).toMatchObject({ title: 'Updated bundle plan' });

    const started = await callJson(client, 'updatePlanTask', { taskId: tasks[0].id, status: 'in_progress', notes: 'Working' });
    expect(started.isError).toBe(false);
    expect(started.body).toMatchObject({ plan: { id: plan.id, status: 'active' } });

    const context = await client.readResource({ uri: 'cognistore://context/mcp-bundle-tools' });
    expect(context.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    const contextText = 'text' in context.contents[0] ? context.contents[0].text : '';
    expect(contextText).toContain('Bundle fact updated');
    expect(contextText).toContain('Updated bundle plan');
    expect(contextText).toContain('## Tags');

    const bulk = await callJson(client, 'updatePlanTasks', { updates: [
      { taskId: tasks[0].id, status: 'completed' },
      { taskId: tasks[1].id, status: 'completed', notes: 'Done' },
    ] });
    expect(bulk.isError).toBe(false);
    expect(bulk.body).toMatchObject({ updated: 2, plan: { id: plan.id, status: 'completed' } });

    const archived = await callJson(client, 'archivePlan', { planId: plan.id });
    expect(archived.body).toMatchObject({ archived: true, id: plan.id, status: 'archived' });
    const missingArchive = await callJson(client, 'archivePlan', { planId: 'missing-plan' });
    expect(missingArchive.body).toEqual({ error: 'not_found', type: 'plan', id: 'missing-plan' });

    const missingTask = await callJson(client, 'updatePlanTask', { taskId: 'missing-task', status: 'completed' });
    expect(missingTask.body).toEqual({ error: 'not_found', type: 'plan_task', id: 'missing-task' });
    const missingPlan = await callJson(client, 'updatePlan', { planId: 'missing-plan', title: 'No plan' });
    expect(missingPlan.body).toEqual({ error: 'not_found', type: 'plan', id: 'missing-plan' });
    const chain = await callJson(client, 'getPlanChain', { planId: 'missing-plan' });
    expect(chain.body).toEqual({ error: 'not_found', type: 'plan', id: 'missing-plan' });
    const deletedKnowledge = await callJson(client, 'deleteKnowledge', { id: knowledgeId });
    expect(deletedKnowledge.body).toEqual({ deleted: true, id: knowledgeId });
    const absentDelete = await callJson(client, 'deleteKnowledge', { id: '00000000-0000-4000-8000-000000000000' });
    expect(absentDelete.body).toEqual({ error: 'not_found', type: 'knowledge_entry', id: '00000000-0000-4000-8000-000000000000' });
    const invalidId = await callJson(client, 'deleteKnowledge', { id: 'not-a-uuid' });
    expect(invalidId.isError).toBe(true);
    const healthAfterInvalidId = await callJson(client, 'healthCheck');
    expect(healthAfterInvalidId.isError).toBe(false);
    expect(healthAfterInvalidId.body).toMatchObject({ database: { connected: true }, ollama: { connected: true } });
  } finally {
    await client?.close().catch(() => {});
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});
