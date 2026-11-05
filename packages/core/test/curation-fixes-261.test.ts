import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { makeDb } from './helpers.js';
import { CurationEngine, CurationRepository, EMBEDDED_MIGRATIONS } from '../src/index.js';

let ctx: ReturnType<typeof makeDb> | undefined;
afterEach(() => { ctx?.cleanup(); ctx = undefined; });

async function add(title: string, content: string, relatedIds?: string[]) {
  return ctx!.repository.create({ title, content, tags: [], type: 'pattern', scope: 'global', source: 'test', relatedIds, embedding: [1, ...Array(255).fill(0)] });
}
function action(repo: CurationRepository, ids: string[], kind: string, payload: any = {}) {
  const now = new Date().toISOString();
  return repo.createAction({
    id: crypto.randomUUID(), kind, actor: 'test', entryIds: ids, snapshot: repo.captureSnapshot(ids), payload,
    versions: Object.fromEntries(ids.map(id => { const e = repo.getEntry(id); return [id, { version: e.version, contentHash: e.content_hash, scope: e.scope, status: e.status }]; })),
    key: `test:${kind}:${ids.join(':')}`, now, undoExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
}
/** A flag shaped like the rows migration 2.4.6 carried over: no snapshot, no expected versions. */
function legacyFlag(id: string, entryIds: string[]) {
  const now = new Date().toISOString();
  ctx!.sqlite.prepare(`INSERT INTO curation_actions(id, kind, actor, entry_ids, payload, status, idempotency_key, created_at, updated_at)
    VALUES (?, 'flag', 'legacy-cleanup', ?, ?, 'proposed', ?, ?, ?)`).run(id, JSON.stringify(entryIds), JSON.stringify({ reason: 'Legacy cleanup candidate (duplicate_group)', suggestedKind: 'merge' }), `legacy-cleanup:${id}`, now, now);
}
const entryRow = (id: string) => ctx!.sqlite.prepare('SELECT title, content, tags, status, version, related_ids FROM knowledge_entries WHERE id=?').get(id) as any;
const actionRow = (id: string) => ctx!.sqlite.prepare('SELECT id, status, applied_at FROM curation_actions WHERE id=?').get(id) as any;
const related = (id: string) => JSON.parse(entryRow(id).related_ids ?? 'null');

describe('curation fixes 2.6.1: relationship lists', () => {
  it('applies a complementary action when both entries have NULL related_ids', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), b = await add('B', 'beta');
    const repo = new CurationRepository(ctx.sqlite), act = action(repo, [a.id, b.id], 'complementary', { relatedIds: [a.id, b.id] });
    expect(new CurationEngine(repo).apply(act.id)).toBe(true);
    expect(related(a.id)).toEqual([b.id]); expect(related(b.id)).toEqual([a.id]);
  });
  it('keeps existing string relations and drops non-string values on complementary apply', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), b = await add('B', 'beta');
    ctx.sqlite.prepare('UPDATE knowledge_entries SET related_ids=? WHERE id=?').run(JSON.stringify([{}, 'zz']), a.id);
    const repo = new CurationRepository(ctx.sqlite), act = action(repo, [a.id, b.id], 'complementary', { relatedIds: [a.id, b.id] });
    expect(new CurationEngine(repo).apply(act.id)).toBe(true); expect(related(a.id)).toEqual(['zz', b.id]);
  });
  it('writes only string ids to the canonical entry on merge when a member has NULL related_ids', async () => {
    ctx = makeDb(); const c = await add('C', 'gamma'), a = await add('A', 'alpha'), b = await add('B', 'beta', [c.id]);
    const repo = new CurationRepository(ctx.sqlite), act = action(repo, [a.id, b.id], 'merge', { canonicalId: a.id, draft: { title: 'Merged', content: 'alpha beta' } });
    expect(new CurationEngine(repo).apply(act.id)).toBe(true); expect(related(a.id)).toEqual([c.id]); expect(entryRow(b.id).status).toBe('superseded');
  });
});

describe('curation fixes 2.6.1: flags are acknowledged, not applied to entries', () => {
  it('acknowledges a legacy flag without snapshot or expected versions and leaves entries untouched', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), b = await add('B', 'beta'), id = '0f1e2d3c-4b5a-4968-8776-655443322110'; legacyFlag(id, [a.id, b.id]);
    const beforeA = entryRow(a.id), beforeB = entryRow(b.id);
    expect(new CurationEngine(new CurationRepository(ctx.sqlite)).apply(id)).toBe(true); expect(actionRow(id).status).toBe('applied'); expect(actionRow(id).applied_at).toEqual(expect.any(String)); expect(entryRow(a.id)).toEqual(beforeA); expect(entryRow(b.id)).toEqual(beforeB);
  });
  it('returns false when the flag is already applied', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), id = '1f1e2d3c-4b5a-4968-8776-655443322110'; legacyFlag(id, [a.id]); const engine = new CurationEngine(new CurationRepository(ctx.sqlite)); expect(engine.apply(id)).toBe(true); expect(engine.apply(id)).toBe(false);
  });
  it('rejects a draft override on a flag and keeps it proposed', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), id = '2f1e2d3c-4b5a-4968-8776-655443322110'; legacyFlag(id, [a.id]);
    expect(() => new CurationEngine(new CurationRepository(ctx!.sqlite)).apply(id, { draftOverride: { title: 'T', content: 'C' } })).toThrow('Draft override is only valid for merge actions'); expect(actionRow(id).status).toBe('proposed');
  });
  it('undo reopens an applied flag and clears applied_at without touching entries', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), id = '3f1e2d3c-4b5a-4968-8776-655443322110'; legacyFlag(id, [a.id]); const engine = new CurationEngine(new CurationRepository(ctx.sqlite)), before = entryRow(a.id);
    expect(engine.apply(id)).toBe(true); expect(engine.undo(id)).toEqual({ actionId: id, status: 'undone' }); expect(actionRow(id)).toEqual({ id, status: 'proposed', applied_at: null }); expect(entryRow(a.id)).toEqual(before);
  });
  it('undo of a flag that is still proposed throws the stale error', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), id = '4f1e2d3c-4b5a-4968-8776-655443322110'; legacyFlag(id, [a.id]); expect(() => new CurationEngine(new CurationRepository(ctx!.sqlite)).undo(id)).toThrow('Curation action is stale, conflicting, or expired');
  });
  it('acknowledges an agent-raised flag created by createFlag', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), engine = new CurationEngine(new CurationRepository(ctx.sqlite)); const { id } = engine.createFlag({ entryId: a.id, reason: 'contradicts B', actor: 'test' }); const before = entryRow(a.id);
    expect(engine.apply(id)).toBe(true); expect(actionRow(id).status).toBe('applied'); expect(entryRow(a.id)).toEqual(before);
  });
});

describe('trash purge with legacy flags', () => {
  it('purges a trashed entry that a legacy flag (NULL snapshots) references', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), id = '6f1e2d3c-4b5a-4968-8776-655443322110'; legacyFlag(id, [a.id]);
    ctx.sqlite.prepare("UPDATE knowledge_entries SET status='trashed', trashed_at=? WHERE id=?").run(new Date(Date.now() - 400 * 86400000).toISOString(), a.id);
    const repo = new CurationRepository(ctx.sqlite); expect(() => repo.purgeEntry(a.id)).not.toThrow(); expect(entryRow(a.id)).toBeUndefined();
  });
});

describe('migration 2.6.1 (data only)', () => {
  it('embedded SQL is identical to the migration file', () => {
    const disk = readFileSync(new URL('../src/db/migrations/2.6.1.sql', import.meta.url), 'utf-8'); expect(EMBEDDED_MIGRATIONS['2.6.1']).toBe(disk);
  });
  it('repairs related_ids, rewrites legacy flag ids, keeps versions and schema, and is idempotent', async () => {
    ctx = makeDb(); const a = await add('A', 'alpha'), b = await add('B', 'beta'), c = await add('C', 'gamma'), d = await add('D', 'delta');
    const set = (id: string, v: string) => ctx!.sqlite.prepare('UPDATE knowledge_entries SET related_ids=? WHERE id=?').run(v, id);
    set(a.id, '[{},{}]'); set(b.id, JSON.stringify([{}, 'x', 3])); set(c.id, JSON.stringify(['y']));
    legacyFlag('cc4787b0d4234b207e971b026fe57797', [a.id]); legacyFlag('CC4787B0D4234B207E971B026FE57798', [a.id]); legacyFlag('5f1e2d3c-4b5a-4968-8776-655443322110', [a.id]);
    const versions = () => ctx!.sqlite.prepare('SELECT id, version FROM knowledge_entries ORDER BY id').all(), schema = () => ctx!.sqlite.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(); const v0 = versions(), s0 = schema();
    ctx.sqlite.exec(EMBEDDED_MIGRATIONS['2.6.1']);
    expect(entryRow(a.id).related_ids).toBe('[]'); expect(entryRow(b.id).related_ids).toBe('["x"]'); expect(entryRow(c.id).related_ids).toBe('["y"]'); expect(entryRow(d.id).related_ids).toBeNull();
    const ids = (ctx.sqlite.prepare('SELECT id FROM curation_actions ORDER BY id').all() as { id: string }[]).map(r => r.id);
    expect(ids).toContain('cc4787b0-d423-4b20-7e97-1b026fe57797'); expect(ids).not.toContain('cc4787b0d4234b207e971b026fe57797'); expect(ids).toContain('CC4787B0D4234B207E971B026FE57798'); expect(ids).toContain('5f1e2d3c-4b5a-4968-8776-655443322110');
    expect(versions()).toEqual(v0); expect(schema()).toEqual(s0);
    const rows = () => [ctx!.sqlite.prepare('SELECT id, related_ids, version FROM knowledge_entries ORDER BY id').all(), ctx!.sqlite.prepare('SELECT id FROM curation_actions ORDER BY id').all()]; const once = rows(); ctx.sqlite.exec(EMBEDDED_MIGRATIONS['2.6.1']); expect(rows()).toEqual(once);
  });
});
