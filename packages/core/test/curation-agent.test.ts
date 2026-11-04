import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CurationRepository } from '../src/repositories/curation.repository.js';
import { CurationEngine } from '../src/services/curation-engine.js';
import { makeDb, stubEmbedding } from './helpers.js';

describe('agent curation in the engine', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => ctx?.cleanup());
  const add = (title: string, extra: Record<string, unknown> = {}) => ctx.repository.create({
    title, content: `${title} content`, type: 'pattern', scope: 'project', source: 'test', tags: [], embedding: stubEmbedding(title), ...extra,
  } as never) as unknown as Promise<{ id: string }>;
  function proposed(repo: CurationRepository, kind: string, ids: string[], payload: Record<string, unknown>) {
    const rows = ids.map(id => repo.getEntry(id));
    const versions = Object.fromEntries(rows.map(r => [r.id, { version: r.version, contentHash: r.content_hash, scope: r.scope, status: r.status }]));
    return repo.createAction({ id: randomUUID(), kind, actor: 'curation', entryIds: ids, snapshot: repo.captureSnapshot(ids), payload, versions,
      key: randomUUID(), now: new Date().toISOString(), undoExpiresAt: new Date(Date.now() + 86_400_000).toISOString() }).id as string;
  }

  it('applies a merge with an override draft, records appliedBy and rejects overrides on other kinds', async () => {
    ctx = makeDb(); const repo = new CurationRepository(ctx.sqlite), engine = new CurationEngine(repo);
    const [a, b, c] = [await add('a'), await add('b'), await add('c')];
    const merge = proposed(repo, 'merge', [a.id, b.id], { canonicalId: a.id, draft: { title: 'old', content: 'old' } });
    const sup = proposed(repo, 'supersedes', [b.id, c.id], { sourceId: c.id, targetId: b.id });
    expect(() => engine.apply(sup, { draftOverride: { title: 't', content: 'c' } })).toThrow(/override/i);
    expect(() => engine.apply(merge, { draftOverride: { title: '', content: '' } })).toThrow();
    expect(engine.apply(merge, { actor: 'agent:test', draftOverride: { title: 'New', content: 'new body' } })).toBe(true);
    expect(repo.getEntry(a.id)).toMatchObject({ title: 'New', content: 'new body' });
    const payload = JSON.parse((ctx.sqlite.prepare('SELECT payload FROM curation_actions WHERE id=?').get(merge) as { payload: string }).payload);
    expect(payload).toMatchObject({ appliedBy: 'agent:test', draft: { title: 'New' } });
  });

  it('creates a flag only for eligible entries, applies it without touching the entry, and undoes it', async () => {
    ctx = makeDb(); const repo = new CurationRepository(ctx.sqlite), engine = new CurationEngine(repo);
    const keep = await add('keep', { tags: ['keep'] }), plain = await add('plain');
    expect(() => engine.createFlag({ entryId: keep.id, reason: 'r', actor: 'agent:x' })).toThrow(/protected/);
    expect(() => engine.createFlag({ entryId: randomUUID(), reason: 'r', actor: 'agent:x' })).toThrow(/not found/);
    expect(() => engine.createFlag({ entryId: plain.id, reason: '  ', actor: 'agent:x' })).toThrow(/reason/);
    const { id } = engine.createFlag({ entryId: plain.id, reason: 'contradiction', actor: 'agent:x' });
    expect(engine.createFlag({ entryId: plain.id, reason: 'contradiction', actor: 'agent:x' }).id).toBe(id);
    expect(engine.apply(id)).toBe(true);
    expect(repo.getEntry(plain.id)).toMatchObject({ status: 'active', title: 'plain' });
    expect(engine.undo(id)).toMatchObject({ status: 'undone' });
  });

  it('getQueue pages oldest first, caps at 25 and returns short excerpts', async () => {
    ctx = makeDb(); const repo = new CurationRepository(ctx.sqlite), engine = new CurationEngine(repo);
    const e = await add('long', { content: 'x'.repeat(5000) });
    for (let i = 0; i < 3; i++) engine.createFlag({ entryId: e.id, reason: `reason ${i}`, actor: 'agent:x' });
    const first = engine.getQueue({ limit: 2 });
    expect(first.actions).toHaveLength(2);
    expect(first.actions[0].entries[0].excerpt.length).toBe(600);
    expect(first.nextCursor).not.toBeNull();
    const second = engine.getQueue({ limit: 2, cursor: first.nextCursor! });
    expect(second.actions).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(engine.getQueue({ limit: 500 }).actions.length).toBe(3);
  });
});
