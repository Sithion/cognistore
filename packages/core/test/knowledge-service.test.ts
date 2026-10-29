import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from './helpers.js';

const input = (overrides: Record<string, unknown> = {}) => ({
  title: 'SQLite WAL guidance', content: 'Use write ahead logging for concurrent readers.',
  tags: [' Database ', 'sqlite', 'database', ''], type: 'pattern' as any,
  scope: 'global', source: 'unit', ...overrides,
});

describe('KnowledgeService knowledge entries', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => { ctx?.service.stopPendingWriteTimers(); ctx?.cleanup(); vi.restoreAllMocks(); });

  it('normalizes tags while preserving first-seen order', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add(input());
    expect(entry.tags).toEqual(['database', 'sqlite']);
    expect(entry.id).toMatch(/[0-9a-f-]{36}/i);
  });

  it('deduplicates close content only within matching scope and type', async () => {
    ctx = makeDb();
    const first = await ctx.service.add(input());
    const merged = await ctx.service.add(input({ title: 'SQLite WAL guidance', content: 'Use write ahead logging for concurrent readers!' }));
    expect(merged.id).toBe(first.id);
    expect(merged.deduplicated).toBe(true);
    const scoped = await ctx.service.add(input({ scope: 'project-a', skipDedup: true }));
    const otherScope = await ctx.service.add(input({ scope: 'project-x' }));
    const otherType = await ctx.service.add(input({ type: 'fact' }));
    expect(otherScope.id).not.toBe(scoped.id);
    expect(otherType.id).not.toBe(first.id);
  });

  it('honors skipDedup', async () => {
    ctx = makeDb();
    const first = await ctx.service.add(input());
    const second = await ctx.service.add(input({ skipDedup: true }));
    expect(second.id).not.toBe(first.id);
    expect(second.deduplicated).toBeUndefined();
  });

  it('searches with type, scope, tag, limit and threshold options', async () => {
    ctx = makeDb();
    const a = await ctx.service.add(input());
    await ctx.service.add(input({ title: 'Redis cache strategy', content: 'Cache invalidation patterns for services.', tags: ['cache'], type: 'fact', scope: 'project-x', skipDedup: true }));
    const filtered = await ctx.service.search('SQLite WAL guidance', { type: 'pattern', scope: 'project-x', tags: ['sqlite'], limit: 1, threshold: 0 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].entry.id).toBe(a.id);
    // By design: hybrid search keeps a keyword (FTS) match even below the semantic threshold (knowledge.repository.ts, searchBySimilarity).
    expect(await ctx.service.search('SQLite WAL guidance', { threshold: 1 })).toHaveLength(1);
  });

  it('buffers trackRead marks and flushes read counts and operation rows', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add(input());
    await ctx.service.search('SQLite WAL', { trackRead: true });
    const before = ctx.sqlite.prepare('SELECT read_count FROM knowledge_entries WHERE id = ?').get(entry.id) as { read_count: number };
    expect(before.read_count).toBe(0);
    ctx.service.flushPendingWrites();
    const after = ctx.sqlite.prepare('SELECT read_count FROM knowledge_entries WHERE id = ?').get(entry.id) as { read_count: number };
    const ops = ctx.sqlite.prepare("SELECT operation, COUNT(*) AS n FROM operations_log GROUP BY operation").all() as { operation: string; n: number }[];
    expect(after.read_count).toBe(1);
    expect(ops.some((r) => r.operation === 'read' && r.n >= 1)).toBe(true);
    expect(ops.some((r) => r.operation === 'write' && r.n >= 1)).toBe(true);
  });

  it('returns null for unknown ids and re-embeds content updates', async () => {
    ctx = makeDb();
    expect(await ctx.service.getById('missing')).toBeNull();
    expect(await ctx.service.update('missing', { title: 'new' })).toBeNull();
    const entry = await ctx.service.add(input());
    const priorVersion = entry.version;
    const updated = await ctx.service.update(entry.id, { content: 'Completely revised guidance for SQLite transactions.' });
    expect(updated?.version).toBe(priorVersion + 1);
    expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM knowledge_embeddings WHERE id = ?').get(entry.id)).toEqual({ n: 1 });
  });

  it('protects system entries from direct and bulk deletion', async () => {
    ctx = makeDb();
    const system = await ctx.service.add(input({ type: 'system', title: 'System direct', skipDedup: true }));
    // The service does not guard system entries on a single delete: the SDK does (KnowledgeSDK.deleteKnowledge), and every caller goes through it.
    expect(await ctx.service.delete(system.id)).toBe(true);
    const protectedByBulk = await ctx.service.add(input({ type: 'system', title: 'System bulk', skipDedup: true }));
    const result = await ctx.service.bulkDelete([protectedByBulk.id, 'missing']);
    expect(result.deleted).toBe(0);
    expect(result.errors).toContain(`Skipped ${protectedByBulk.id}: system knowledge cannot be deleted`);
    expect(await ctx.service.getById(system.id)).toBeNull();
  });

  it('bulk deletes regular rows and ignores missing ids', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add(input());
    expect(await ctx.service.bulkDelete([entry.id, 'missing'])).toEqual({ deleted: 1, errors: [] });
    expect(await ctx.service.getById(entry.id)).toBeNull();
  });

  it('imports by title-content hash and defaults source to import', async () => {
    ctx = makeDb();
    const result = await ctx.service.importKnowledge([
      input({ title: 'Imported', content: 'A unique imported fact', tags: ['X'], source: undefined }),
      input({ title: 'Imported', content: 'A unique imported fact', tags: ['X'], source: undefined }),
    ] as any);
    expect(result).toEqual({ imported: 1, skipped: 1, errors: [] });
    const row = ctx.sqlite.prepare("SELECT source FROM knowledge_entries WHERE title = 'Imported'").get() as { source: string };
    expect(row.source).toBe('import');
  });

  it('re-embeds existing entries and backfills missing vectors', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add(input());
    expect(await ctx.service.reembedAll()).toBeGreaterThanOrEqual(1);
    ctx.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(entry.id);
    expect(await ctx.service.embeddingCoverage()).toMatchObject({ missingEntries: 1 });
    const progress: unknown[] = [];
    expect(await ctx.service.embedMissing({ onProgress: (p) => progress.push(p) })).toEqual({ embedded: 1, failed: 0, remaining: 0, cancelled: false });
    expect(progress).toEqual(expect.arrayContaining([
      { phase: 'knowledge', done: 0, total: 1, failed: 0 },
      { phase: 'knowledge', done: 1, total: 1, failed: 0 },
    ]));
  });

  it('merges one tag and collapses duplicate tags', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add(input({ tags: ['old', 'new'] }));
    expect(await ctx.service.mergeTag(' old ', 'new')).toEqual({ merged: 1 });
    expect((await ctx.service.getById(entry.id))?.tags).toEqual(['new']);
    expect(await ctx.service.mergeTag('new', 'new')).toEqual({ merged: 0 });
  });

  it('batch merges chains once and rejects conflicting or cyclic inputs before writes', async () => {
    ctx = makeDb();
    const entry = await ctx.service.add(input({ tags: ['alpha', 'beta'] }));
    const result = await ctx.service.mergeTagsBatch([{ from: ' alpha ', to: 'beta' }, { from: 'beta', to: 'gamma' }, { from: 'x', to: 'x' }]);
    expect(result.entriesReembedded).toBe(1);
    expect((await ctx.service.getById(entry.id))?.tags).toEqual(['gamma']);
    await expect(ctx.service.mergeTagsBatch([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])).rejects.toThrow('CONFLICT');
    await expect(ctx.service.mergeTagsBatch([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).rejects.toThrow('CONFLICT');
  });

  it('reports cleanup candidates and dismisses candidates', async () => {
    ctx = makeDb();
    const old = await ctx.service.add(input({ title: 'Deprecated note', tags: ['deprecated'], skipDedup: true }));
    const generated = await ctx.service.generateCleanupReport();
    expect(generated.created).toBe(true);
    expect((await ctx.service.generateCleanupReport()).created).toBe(false);
    const latest = ctx.service.getLatestCleanupReport();
    expect(latest?.report.id).toBe(generated.report.id);
    const candidate = latest!.candidates.find((c) => c.category === 'deprecated')!;
    expect(ctx.service.getCleanupCandidate(candidate.id)?.entryIds).toEqual([old.id]);
    expect(ctx.service.getEntriesForCleanupCandidate(candidate.id)).toHaveLength(1);
    expect(ctx.service.countPendingCleanupCandidates()).toBeGreaterThan(0);
    ctx.service.dismissCleanupCandidate(candidate.id);
    expect(ctx.service.getCleanupCandidate(candidate.id)?.status).toBe('dismissed');
    expect(() => ctx.service.dismissCleanupCandidate(candidate.id)).toThrow('not pending');
    expect(ctx.service.previewMergedTags([{ tags: ['a', 'shared'] }, { tags: ['b', 'shared'] }])).toEqual(['a', 'shared', 'b']);
  });

  it('revalidates and applies a removal candidate, then closes the report with a tally', async () => {
    ctx = makeDb();
    const old = await ctx.service.add(input({ title: 'Deprecated note', tags: ['deprecated'], skipDedup: true }));
    const { report } = await ctx.service.generateCleanupReport();
    const candidate = ctx.service.getLatestCleanupReport()!.candidates.find((c) => c.category === 'deprecated')!;
    expect(await ctx.service.applyRemovalCandidate(candidate.id)).toEqual({ deleted: 1, skipped: 0, errors: [] });
    await expect(ctx.service.applyRemovalCandidate(candidate.id)).rejects.toThrow('not pending');
    expect(await ctx.service.getById(old.id)).toBeNull();
    expect(ctx.service.closeCleanupReport(report.id, { reviewed: true })).toEqual({ removed: 1 });
    expect(ctx.service.getLatestCleanupReport()?.report.status).toBe('closed');
  });

  it('rejects invalid cleanup candidate actions and unknown report ids', async () => {
    ctx = makeDb();
    await expect(ctx.service.applyRemovalCandidate('missing')).rejects.toThrow('not found');
    await expect(ctx.service.applyConsolidationCandidate('missing', {})).rejects.toThrow('not found');
    expect(() => ctx.service.dismissCleanupCandidate('missing')).toThrow('not found');
    expect(() => ctx.service.closeCleanupReport('missing')).toThrow('not found');
    expect(ctx.service.getLatestCleanupReport()).toBeNull();
    expect(ctx.service.getCleanupCandidate('missing')).toBeNull();
    expect(ctx.service.getEntriesForCleanupCandidate('missing')).toEqual([]);
  });

  it('flushes buffered writes and cancels timers on close', async () => {
    ctx = makeDb();
    await ctx.service.search('no matches');
    ctx.service.flushOperations();
    expect(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM operations_log WHERE operation = 'read'").get()).toMatchObject({ n: 1 });
    ctx.service.stopPendingWriteTimers();
  });
});
