import { afterEach, expect, it, vi } from 'vitest';
import { makeDb, stubEmbedding } from './helpers.js';
import { KnowledgeService } from '../src/services/knowledge.service.js';

let ctx: ReturnType<typeof makeDb>;
afterEach(() => { ctx?.service.stopPendingWriteTimers(); ctx?.cleanup(); vi.restoreAllMocks(); });
const input = (overrides: Record<string, unknown> = {}) => ({
  title: 'SQLite WAL guidance', content: 'Use write ahead logging for concurrent readers.',
  tags: ['sqlite'], type: 'pattern' as any, scope: 'workspace:write-tests', source: 'unit', ...overrides,
});
const state = () => ({
  rows: ctx.sqlite.prepare('SELECT * FROM knowledge_entries ORDER BY id').all(),
  vectors: ctx.sqlite.prepare('SELECT id, embedding FROM knowledge_embeddings ORDER BY id').all(),
  fts: ctx.sqlite.prepare('SELECT * FROM knowledge_fts ORDER BY id').all(),
  actions: ctx.sqlite.prepare('SELECT * FROM curation_actions ORDER BY id').all(),
});

it('identical re-add still deduplicates and preserves provenance; similar content inserts with hint', async () => {
  ctx = makeDb();
  const first = await ctx.service.add(input({ agentId: 'author', platform: 'claude-code' }));
  const advisory = vi.spyOn(ctx.repository, 'findAdvisoryNeighbours');
  const duplicate = await ctx.service.add(input({ source: 're-add', agentId: undefined, platform: undefined }));
  expect(duplicate).toMatchObject({ id: first.id, deduplicated: true, version: first.version + 1,
    source: 're-add', agentId: 'author', platform: 'claude-code' });
  expect(advisory).not.toHaveBeenCalled();
  const readded = await ctx.service.add(input({ agentId: 'reviewer' }));
  expect(readded).toMatchObject({ id: first.id, deduplicated: true, version: duplicate.version + 1,
    agentId: 'reviewer', platform: 'claude-code' });
  expect(await ctx.service.listAll()).toHaveLength(1);
  const similar = await ctx.service.add(input({ content: `${first.content}!` }));
  expect(similar.id).not.toBe(first.id);
  expect(similar.deduplicated).toBeUndefined();
  expect(similar.similarExisting).toEqual([expect.objectContaining({ id: first.id })]);
  expect(similar.hint).toBe('considere updateKnowledge(id) em vez de criar');
  expect(await ctx.service.getById(first.id)).toEqual(firstWithoutAdvisory(readded));
  const bypass = await ctx.service.add(input({ skipDedup: true }));
  expect(bypass.id).not.toBe(first.id);
  expect(bypass.deduplicated).toBeUndefined();
  expect(bypass.similarExisting).toEqual([]);
  const scoped = await ctx.service.add(input({ scope: 'workspace:other' }));
  expect(scoped.id).not.toBe(first.id);
  expect(scoped.deduplicated).toBeUndefined();
});

it('similar add inserts and reports exact-scope active neighbours', async () => {
  ctx = makeDb();
  const first = await ctx.service.add(input());
  await ctx.service.add(input({ scope: 'global' }));
  await ctx.service.add(input({ scope: 'workspace:other' }));
  const archived = await ctx.service.add(input({ skipDedup: true }));
  ctx.repository.transitionStatus(archived.id, 'archived');
  const second = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers in SQLite.' }));
  expect(second.id).not.toBe(first.id);
  expect(second.deduplicated).toBeUndefined();
  expect(second.similarExisting).toEqual([{ id: first.id, title: first.title, similarity: expect.any(Number) }]);
  expect(second.similarExisting[0].similarity).toBeGreaterThanOrEqual(0.88);
  expect(second.hint).toBe('considere updateKnowledge(id) em vez de criar');
  expect(await ctx.service.getById(first.id)).toEqual(firstWithoutAdvisory(first));
  for (let i = 0; i < 6; i++) await ctx.service.add(input({ skipDedup: true }));
  expect((await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers safely.' }))).similarExisting).toHaveLength(5);
});

function firstWithoutAdvisory(entry: any) {
  const { similarExisting, hint, deduplicated, ...row } = entry;
  return row;
}

it('advisory failure still inserts without overwriting existing knowledge', async () => {
  ctx = makeDb();
  const first = await ctx.service.add(input());
  vi.spyOn(ctx.repository, 'findAdvisoryNeighbours').mockRejectedValue(new Error('lookup down'));
  const second = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers in SQLite.' }));
  expect(second.id).not.toBe(first.id);
  expect(second.similarExisting).toEqual([]);
  expect(second.hint).toBeUndefined();
  expect(await ctx.service.getById(first.id)).toEqual(firstWithoutAdvisory(first));
  expect(await ctx.service.listAll()).toHaveLength(2);
});

it('supersedes commits entry vectors status and audit together', async () => {
  ctx = makeDb();
  const old = await ctx.service.add(input());
  const next = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers in SQLite.', supersedes: [old.id, old.id] }));
  expect(await ctx.service.getById(old.id)).toMatchObject({ status: 'superseded', supersededBy: next.id, version: old.version + 1 });
  expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM knowledge_embeddings').get()).toEqual({ n: 2 });
  expect(ctx.sqlite.prepare('SELECT id FROM knowledge_fts').all()).toEqual([{ id: next.id }]);
  const actions = ctx.sqlite.prepare('SELECT * FROM curation_actions').all() as any[];
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ status: 'applied', actor: 'user', kind: 'supersedes' });
  expect(JSON.parse(actions[0].entry_ids)).toEqual([next.id, old.id]);
  expect(JSON.parse(actions[0].after_snapshot).entries[old.id].superseded_by).toBe(next.id);
  // A late audit error rolls back the new row, vector, FTS and target mutation.
  const before = state();
  ctx.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON curation_actions BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
  await expect(ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers safely.', supersedes: [next.id] }))).rejects.toThrow('audit failed');
  expect(state()).toEqual(before);
});

it('invalid protected stale or cyclic supersedes rolls back every write', async () => {
  ctx = makeDb();
  const target = await ctx.service.add(input());
  const kept = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers safely.', tags: ['keep'] }));
  const system = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers reliably.', type: 'system' }));
  const foreign = await ctx.service.add(input({ scope: 'global' }));
  const inactive = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers efficiently.' }));
  ctx.repository.transitionStatus(inactive.id, 'archived');
  for (const supersedes of [['bad'], [crypto.randomUUID()], [kept.id], [system.id], [foreign.id], [inactive.id], [target.id, 'bad']]) {
    const before = state();
    await expect(ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers in SQLite.', supersedes }))).rejects.toThrow();
    expect(state()).toEqual(before);
  }
  for (const overrides of [{ tags: ['keep'] }, { type: 'system' }]) {
    const before = state();
    await expect(ctx.service.add(input({ ...overrides, content: 'Use write ahead logging for concurrent readers in SQLite.', supersedes: [target.id] }))).rejects.toThrow();
    expect(state()).toEqual(before);
  }
  const beforeSelf = state();
  await expect(ctx.service.update(target.id, { supersedes: [target.id] })).rejects.toThrow();
  expect(state()).toEqual(beforeSelf);
  const source = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers in SQLite.' }));
  ctx.sqlite.prepare('UPDATE knowledge_entries SET superseded_by=? WHERE id=?').run(target.id, source.id);
  const beforeCycle = state();
  await expect(ctx.service.update(source.id, { supersedes: [target.id] })).rejects.toThrow('cycle');
  expect(state()).toEqual(beforeCycle);
  const racing = new KnowledgeService(ctx.repository, { async embed(text) {
    ctx.sqlite.prepare('UPDATE knowledge_entries SET version=version+1 WHERE id=?').run(target.id);
    return stubEmbedding(text);
  } });
  const rowsBefore = ctx.sqlite.prepare('SELECT count(*) AS n FROM knowledge_entries').get();
  await expect(racing.add(input({ content: 'Use write ahead logging for concurrent readers consistently.', supersedes: [target.id] }))).rejects.toThrow('Stale');
  racing.stopPendingWriteTimers();
  expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM knowledge_entries').get()).toEqual(rowsBefore);
  expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM curation_actions').get()).toEqual({ n: 0 });
});

it('update supersedes returns neighbours and preserves provenance', async () => {
  ctx = makeDb();
  const source = await ctx.service.add(input({ agentId: 'author', platform: 'claude-code' }));
  const target = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers in SQLite.' }));
  const result = await ctx.service.update(source.id, { title: undefined, tags: undefined, scope: undefined, agentId: undefined, content: target.content, supersedes: [target.id] });
  expect(result).toMatchObject({ id: source.id, agentId: 'author', platform: 'claude-code', version: source.version + 1 });
  expect(result?.similarExisting).toEqual([{ id: target.id, title: target.title, similarity: expect.any(Number) }]);
  expect(result?.hint).toBe('considere updateKnowledge(id) em vez de criar');
  expect(await ctx.service.getById(target.id)).toMatchObject({ status: 'superseded', supersededBy: source.id });
  expect(ctx.sqlite.prepare('SELECT status FROM curation_actions').all()).toEqual([{ status: 'applied' }]);
  const before = state();
  ctx.sqlite.exec("CREATE TRIGGER reject_update_audit BEFORE INSERT ON curation_actions BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
  const other = await ctx.service.add(input({ content: 'Use write ahead logging for concurrent readers safely.' }));
  const withOther = state();
  await expect(ctx.service.update(source.id, { title: 'Changed title', supersedes: [other.id] })).rejects.toThrow('audit failed');
  expect(state()).toEqual(withOther);
  expect(before.actions).toEqual(withOther.actions);
});
