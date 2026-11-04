import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDbClient, CurationRepository, KnowledgeRepository } from '@cognistore/core';
import { MCP_ENTRY, bundleLaunch, callJson, connectMcp } from '../mcp-helpers.js';
import { startMockOllama } from '../sidecar-helpers.js';

// Round 10 (3.1): getCurationQueue / resolveCuration / supersedeKnowledge through the REAL
// MCP bundle over stdio. Sandboxed HOME, loopback mock Ollama, no real model.
let home: string;
let dbPath: string;
let mock: Awaited<ReturnType<typeof startMockOllama>>;
let client: Awaited<ReturnType<typeof connectMcp>>;
let connection: ReturnType<typeof createDbClient>;
let repo: KnowledgeRepository;
let curation: CurationRepository;
const vec = [1, ...Array(255).fill(0)];

async function launch(platform = 'claude-code') {
  return connectMcp(bundleLaunch(MCP_ENTRY), {
    HOME: home, SQLITE_PATH: dbPath, COGNISTORE_HOME: join(home, '.cognistore'),
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text', COGNISTORE_PLATFORM: platform,
  });
}
async function entry(title: string, scope = 'workspace:r10', tags: string[] = [], type = 'pattern') {
  return repo.create({ title, content: `${title} content`, type, scope, source: 'test', tags, embedding: vec } as never) as unknown as Promise<{ id: string }>;
}
function action(kind: string, ids: string[], payload: Record<string, unknown>) {
  const rows = ids.map(id => curation.getEntry(id));
  const versions = Object.fromEntries(rows.map(r => [r.id, { version: r.version, contentHash: r.content_hash, scope: r.scope, status: r.status }]));
  const now = new Date().toISOString();
  return curation.createAction({ id: randomUUID(), kind, actor: 'curation', entryIds: ids, snapshot: curation.captureSnapshot(ids),
    confidence: 0.9, payload, versions, key: `${kind}:${ids.join(',')}:${randomUUID()}`, now, undoExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }).id as string;
}
const row = (id: string) => connection.sqlite.prepare('SELECT * FROM curation_actions WHERE id=?').get(id) as { status: string; actor: string; payload: string };
const entryRow = (id: string) => curation.getEntry(id) as { title: string; content: string; status: string };

test.describe.configure({ mode: 'serial', timeout: 90_000 });
test.beforeEach(async () => {
  test.skip(!existsSync(MCP_ENTRY), 'Built MCP bundle required');
  home = mkdtempSync(join(tmpdir(), 'curation-agent-r10-'));
  mkdirSync(join(home, '.cognistore'));
  dbPath = join(home, 'knowledge.db');
  mock = await startMockOllama('nomic-embed-text');
  client = await launch();           // creates and migrates the database
  connection = createDbClient(dbPath);
  repo = new KnowledgeRepository(connection.db, connection.sqlite);
  curation = new CurationRepository(connection.sqlite);
});
test.afterEach(async () => {
  await client?.close().catch(() => {});
  try { connection.sqlite.close(); } catch { /* closed */ }
  await new Promise<void>(r => mock.server.close(() => r()));
  rmSync(home, { recursive: true, force: true });
});

test('queue is empty at first, then lists proposals with at most 3 short excerpts and honours scope', async () => {
  expect((await callJson(client, 'getCurationQueue', {})).body).toEqual({ actions: [], nextCursor: null });
  const [a, b, c, d] = [await entry('A dup'), await entry('B dup'), await entry('C other', 'workspace:other'), await entry('D other', 'workspace:other')];
  action('merge', [a.id, b.id], { canonicalId: a.id, draft: { title: 'Merged AB', content: 'merged ab' } });
  action('supersedes', [c.id, d.id], { sourceId: c.id, targetId: d.id });
  const all = (await callJson(client, 'getCurationQueue', { limit: 25 })).body as { actions: any[] };
  expect(all.actions.map(x => x.kind).sort()).toEqual(['merge', 'supersedes']);
  expect(all.actions[0].entries.length).toBeLessThanOrEqual(3);
  expect(all.actions[0].entries[0].excerpt.length).toBeLessThanOrEqual(600);
  const scoped = (await callJson(client, 'getCurationQueue', { scope: 'workspace:r10' })).body as { actions: any[] };
  expect(scoped.actions.map(x => x.kind)).toEqual(['merge']);
  expect((await callJson(client, 'getCurationQueue', { limit: 99 })).isError).toBe(true);
});

test('resolveCuration reports not_found, invalid and stale as data, and never mutates on invalid input', async () => {
  const [a, b] = [await entry('S1'), await entry('S2')];
  const sup = action('supersedes', [a.id, b.id], { sourceId: a.id, targetId: b.id });
  const unknown = await callJson(client, 'resolveCuration', { itemId: randomUUID(), decision: 'apply', reason: 'x' });
  expect(unknown.body).toMatchObject({ error: 'not_found' });
  const override = await callJson(client, 'resolveCuration', { itemId: sup, decision: 'apply', mergedTitle: 'T', mergedContent: 'C', reason: 'x' });
  expect(override.body).toMatchObject({ error: 'invalid' });
  const half = await callJson(client, 'resolveCuration', { itemId: sup, decision: 'apply', mergedTitle: 'only title', reason: 'x' });
  expect(half.body).toMatchObject({ error: 'invalid' });
  expect(row(sup).status).toBe('proposed');
  expect(entryRow(b.id).status).toBe('active');
  expect((await callJson(client, 'resolveCuration', { itemId: sup, decision: 'reject', reason: 'distinct' })).body).toMatchObject({ rejected: true });
  expect(row(sup).status).toBe('rejected');
  expect((await callJson(client, 'resolveCuration', { itemId: sup, decision: 'reject', reason: 'again' })).body).toMatchObject({ error: 'stale' });
});

test('apply with a merged text override rewrites the canonical entry and records the agent actor', async () => {
  const [a, b] = [await entry('M1'), await entry('M2')];
  const id = action('merge', [a.id, b.id], { canonicalId: a.id, draft: { title: 'Machine draft', content: 'machine content' } });
  const r = await callJson(client, 'resolveCuration', { itemId: id, decision: 'apply', mergedTitle: 'Agent merged', mergedContent: 'agent merged content', reason: 'same fact' });
  expect(r.body).toMatchObject({ applied: true, actor: 'agent:claude-code' });
  expect(entryRow(a.id)).toMatchObject({ title: 'Agent merged', content: 'agent merged content' });
  expect(entryRow(b.id).status).toBe('superseded');
  const saved = row(id);
  expect(saved.status).toBe('applied');
  expect(JSON.parse(saved.payload)).toMatchObject({ appliedBy: 'agent:claude-code', draft: { title: 'Agent merged' } });
  const state = JSON.parse(readFileSync(join(home, '.cognistore', 'agent-maintenance.json'), 'utf-8'));
  expect(Number.isFinite(Date.parse(state.lastAt))).toBe(true);
});

test('a hostile COGNISTORE_PLATFORM is recorded as agent:unknown', async () => {
  await client.close();
  client = await launch('evil$(touch x)');
  const [a, b] = [await entry('H1'), await entry('H2')];
  const id = action('merge', [a.id, b.id], { canonicalId: a.id, draft: { title: 'D', content: 'd' } });
  expect((await callJson(client, 'resolveCuration', { itemId: id, decision: 'apply', reason: 'ok' })).body).toMatchObject({ applied: true, actor: 'agent:unknown' });
  expect(JSON.parse(row(id).payload).appliedBy).toBe('agent:unknown');
});

test('flag creates a proposed action visible in the queue; protected entries are refused; applying a flag changes nothing', async () => {
  const keep = await entry('Kept', 'workspace:r10', ['keep']);
  const plain = await entry('Plain');
  expect((await callJson(client, 'resolveCuration', { itemId: keep.id, decision: 'flag', reason: 'contradicts X' })).body).toMatchObject({ error: 'invalid' });
  const flagged = (await callJson(client, 'resolveCuration', { itemId: plain.id, decision: 'flag', reason: 'contradicts Y' })).body as { flagged: boolean; actionId: string };
  expect(flagged.flagged).toBe(true);
  expect(row(flagged.actionId)).toMatchObject({ status: 'proposed', actor: 'agent:claude-code' });
  const queue = (await callJson(client, 'getCurationQueue', {})).body as { actions: any[] };
  expect(queue.actions.find(a => a.id === flagged.actionId)).toMatchObject({ kind: 'flag', reason: 'contradicts Y' });
  expect((await callJson(client, 'resolveCuration', { itemId: flagged.actionId, decision: 'apply', reason: 'seen' })).body).toMatchObject({ applied: true });
  expect(entryRow(plain.id).status).toBe('active');
});

test('supersedeKnowledge refuses cross-scope, protected and unknown entries, and supersedes valid ones', async () => {
  const [n, o1] = [await entry('Newer'), await entry('Older')];
  const other = await entry('Elsewhere', 'workspace:other');
  const keep = await entry('Protected', 'workspace:r10', ['keep']);
  expect((await callJson(client, 'supersedeKnowledge', { oldIds: [other.id], newId: n.id, reason: 'r' })).body).toMatchObject({ error: 'invalid' });
  expect((await callJson(client, 'supersedeKnowledge', { oldIds: [keep.id], newId: n.id, reason: 'r' })).body).toMatchObject({ error: 'invalid' });
  expect((await callJson(client, 'supersedeKnowledge', { oldIds: [randomUUID()], newId: n.id, reason: 'r' })).body).toMatchObject({ error: 'not_found' });
  expect(entryRow(other.id).status).toBe('active');
  const ok = await callJson(client, 'supersedeKnowledge', { oldIds: [o1.id], newId: n.id, reason: 'replaced' });
  expect(ok.body).toMatchObject({ superseded: [o1.id], by: n.id });
  expect(entryRow(o1.id).status).toBe('superseded');
});
