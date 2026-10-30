import { test, expect } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockOllama } from '../sidecar-helpers.js';
import { MCP_ENTRY, bundleLaunch, callJson, connectMcp } from '../mcp-helpers.js';

/**
 * Frozen MCP contract (plan v2.6, T.6). Agents, skills and the npm builds in the
 * wild depend on the tool surface, so it may not drift by accident:
 *   - tool names, input schemas and annotations must equal the snapshot EXACTLY;
 *   - every tool's response must keep every field (and its type) the snapshot
 *     recorded — new fields are allowed, removed or retyped ones are not.
 *
 * The snapshot was generated from the v2.5.4 bundle (`main`), so this also
 * proves 2.6 exposes the same surface as the published 2.5.4.
 *
 * Changing the contract on purpose:
 *   UPDATE_MCP_CONTRACT=1 npx playwright test src/contract/mcp-contract.test.ts
 * (MCP_CONTRACT_ENTRY=<path to another dist/index.js> snapshots that build instead).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = resolve(__dirname, 'mcp-contract.snapshot.json');
const ENTRY = process.env.MCP_CONTRACT_ENTRY || MCP_ENTRY;
const UPDATE = process.env.UPDATE_MCP_CONTRACT === '1';

type Shape = string | Shape[] | { [k: string]: Shape };
type Snapshot = { tools: unknown[]; responses: Record<string, Shape> };

/** Type skeleton of a JSON value: what a consumer can rely on, not the values. */
function shapeOf(v: unknown): Shape {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
  if (typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, shapeOf((v as any)[k])]));
  }
  return typeof v;
}

/** Every path of `expected` must exist in `actual` with the same type. Returns the violations. */
function missingFrom(expected: Shape, actual: Shape, path = '$'): string[] {
  if (typeof expected === 'string') {
    // A nullable field seen as null in one run and filled in another is not a break.
    if (expected === 'null' || actual === 'null') return [];
    return expected === actual ? [] : [`${path}: ${expected} → ${JSON.stringify(actual)}`];
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: array → ${JSON.stringify(actual)}`];
    return expected.length && actual.length ? missingFrom(expected[0], actual[0], `${path}[]`) : [];
  }
  if (typeof actual !== 'object' || Array.isArray(actual)) return [`${path}: object → ${JSON.stringify(actual)}`];
  return Object.keys(expected).flatMap((k) =>
    k in actual ? missingFrom(expected[k], actual[k], `${path}.${k}`) : [`${path}.${k}: removed`],
  );
}

let dir: string;
let mock: Awaited<ReturnType<typeof startMockOllama>>;
let client: Client;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  test.skip(!existsSync(ENTRY), `built MCP server missing at ${ENTRY} — run \`pnpm build\` first`);
  dir = mkdtempSync(join(tmpdir(), 'cognistore-mcp-contract-'));
  mock = await startMockOllama('nomic-embed-text');
  client = await connectMcp(bundleLaunch(ENTRY), {
    HOME: dir,
    SQLITE_PATH: join(dir, 'knowledge.db'),
    COGNISTORE_HOME: join(dir, '.cognistore'),
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
    OLLAMA_MODEL: 'nomic-embed-text',
    COGNISTORE_PLATFORM: 'claude-code',
  });
});

test.afterAll(async () => {
  await client?.close().catch(() => {});
  await new Promise<void>((r) => (mock ? mock.server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** One call of every tool, in an order where each finds what it needs. */
async function exerciseAllTools(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await callJson(client, name, args);
    expect(r.isError, `${name} returned an error: ${JSON.stringify(r.body)}`).toBe(false);
    out[name] = r.body;
    return r.body as any;
  };

  await call('healthCheck');
  const entry = { title: 'Contract entry', content: 'Frozen MCP contract example content.', tags: ['contract'], type: 'pattern', scope: 'workspace:contract', source: 'mcp-contract.test' };
  const added = await call('addKnowledge', { entries: entry });
  const knowledgeId: string = added.id ?? added.entry?.id ?? added[0]?.id ?? added.entries?.[0]?.id;
  expect(knowledgeId, `addKnowledge response carries an id: ${JSON.stringify(added)}`).toBeTruthy();
  await call('getKnowledge', { query: 'frozen contract example' });
  await call('listTags');
  await call('updateKnowledge', { id: knowledgeId, content: 'Frozen MCP contract example content, updated.' });

  const plan = await call('createPlan', {
    title: 'Contract plan', content: '## Context\nContract.', tags: ['contract'], scope: 'workspace:contract', source: 'mcp-contract.test',
    tasks: [{ description: 'first' }, { description: 'second' }],
  });
  const planId: string = plan.id;
  expect(planId).toBeTruthy();
  await call('listPlans', { scope: 'workspace:contract' });
  const tasks = await call('listPlanTasks', { planId });
  const [first, second] = tasks.tasks.map((t: { id: string }) => t.id);
  const extra = await call('addPlanTask', { planId, description: 'third' });
  await call('updatePlanTask', { taskId: first, status: 'in_progress' });
  await call('updatePlanTasks', { updates: [{ taskId: second, status: 'in_progress' }] });
  await call('updatePlan', { planId, title: 'Contract plan (renamed)' });
  await call('addPlanRelation', { planId, knowledgeId, relationType: 'output' });
  await call('getPlanChain', { planId });
  await call('getTokenUsage', { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to: new Date().toISOString() });
  await call('deletePlanTask', { taskId: extra.id ?? extra.task?.id });
  await call('archivePlan', { planId });
  await call('deleteKnowledge', { id: knowledgeId });
  return out;
}

test('tool names, input schemas and annotations are frozen (= v2.5.4)', async () => {
  const { tools } = await client.listTools();
  const current = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  if (UPDATE) {
    const prev: Partial<Snapshot> = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};
    writeFileSync(SNAPSHOT, JSON.stringify({ ...prev, tools: current }, null, 2) + '\n');
  }
  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'));
  expect(current.map((t) => t.name)).toEqual((snap.tools as { name: string }[]).map((t) => t.name));
  expect(current).toEqual(snap.tools);
});

test('every tool answers, and no response loses a field the contract recorded', async () => {
  const bodies = await exerciseAllTools();
  const shapes = Object.fromEntries(Object.entries(bodies).map(([k, v]) => [k, shapeOf(v)]));
  if (UPDATE) {
    const prev: Partial<Snapshot> = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'));
    writeFileSync(SNAPSHOT, JSON.stringify({ ...prev, responses: shapes }, null, 2) + '\n');
  }
  const snap: Snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'));
  // All 18 tools were exercised, and all of them are in the recorded contract.
  expect(Object.keys(shapes).sort()).toEqual((snap.tools as { name: string }[]).map((t) => t.name).sort());
  const broken = Object.entries(snap.responses).flatMap(([tool, shape]) => missingFrom(shape, shapes[tool], tool));
  expect(broken).toEqual([]);
});
