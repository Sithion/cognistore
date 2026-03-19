import { test, expect } from '@playwright/test';
import { createTestContext, destroyTestContext, createFactory, type TestContext } from '../test-helpers.js';
import { KnowledgeType } from '@ai-knowledge/shared';

let ctx: TestContext;
let factory: ReturnType<typeof createFactory>;

test.beforeAll(() => {
  ctx = createTestContext();
  factory = createFactory(ctx.service);
});
test.afterAll(() => {
  destroyTestContext(ctx);
});

test('addKnowledge with title works and returns all fields', async () => {
  const entry = await factory.knowledge({
    title: 'My Title',
    content: 'Some content about testing',
    tags: ['alpha', 'beta'],
    type: KnowledgeType.DECISION,
    scope: 'workspace:myproject',
    source: 'unit-test',
  });

  expect(entry.id).toBeTruthy();
  expect(entry.title).toBe('My Title');
  expect(entry.content).toBe('Some content about testing');
  expect(entry.tags).toEqual(['alpha', 'beta']);
  expect(entry.type).toBe(KnowledgeType.DECISION);
  expect(entry.scope).toBe('workspace:myproject');
  expect(entry.source).toBe('unit-test');
  expect(entry.version).toBe(1);
  expect(entry.confidenceScore).toBe(1.0);
  expect(entry.createdAt).toBeInstanceOf(Date);
  expect(entry.updatedAt).toBeInstanceOf(Date);
});

test('search returns results with similarity score', async () => {
  await factory.knowledge({ tags: ['search-test'], content: 'Unique searchable content xyz123' });

  const results = await ctx.service.search('search-test');
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].similarity).toBeGreaterThan(0);
  expect(results[0].similarity).toBeLessThanOrEqual(1);
  expect(results[0].entry).toBeDefined();
  expect(results[0].entry.id).toBeTruthy();
});

test('search with scope filter returns specific scope + global', async () => {
  const globalEntry = await factory.knowledge({ scope: 'global', tags: ['scope-test-unique'], content: 'Global scope entry for filter' });
  const projectEntry = await factory.knowledge({ scope: 'workspace:proj1', tags: ['scope-test-unique'], content: 'Project scope entry for filter' });
  await factory.knowledge({ scope: 'workspace:proj2', tags: ['scope-test-unique'], content: 'Other project entry for filter' });

  const results = await ctx.service.search('scope-test-unique', { scope: 'workspace:proj1', threshold: 0.0 });
  const ids = results.map((r) => r.entry.id);

  expect(ids).toContain(globalEntry.id);
  expect(ids).toContain(projectEntry.id);
});

test('search with tag filter', async () => {
  await factory.knowledge({ tags: ['unique-tag-filter-abc'], content: 'Entry with unique tag filter' });
  await factory.knowledge({ tags: ['other-tag-xyz'], content: 'Entry with other tag' });

  const results = await ctx.service.search('unique-tag-filter-abc', { tags: ['unique-tag-filter-abc'], threshold: 0.0 });
  for (const r of results) {
    expect(r.entry.tags).toContain('unique-tag-filter-abc');
  }
});

test('search with type filter', async () => {
  await factory.knowledge({ type: KnowledgeType.FIX, tags: ['type-filter-test'], content: 'A fix entry for type filter' });
  await factory.knowledge({ type: KnowledgeType.GOTCHA, tags: ['type-filter-test'], content: 'A gotcha entry for type filter' });

  const results = await ctx.service.search('type-filter-test', { type: KnowledgeType.FIX, threshold: 0.0 });
  for (const r of results) {
    expect(r.entry.type).toBe(KnowledgeType.FIX);
  }
});

test('search returns empty for completely unrelated query with high threshold', async () => {
  const results = await ctx.service.search('zzzzzzzzunrelatedqueryxxx999', { threshold: 0.99 });
  expect(results).toEqual([]);
});

test('updateKnowledge updates title and increments version', async () => {
  const entry = await factory.knowledge({ title: 'Original Title' });
  expect(entry.version).toBe(1);

  const updated = await ctx.service.update(entry.id, { title: 'Updated Title' });
  expect(updated).not.toBeNull();
  expect(updated!.title).toBe('Updated Title');
  expect(updated!.version).toBe(2);
});

test('deleteKnowledge works and returns false for non-existent', async () => {
  const entry = await factory.knowledge();
  const deleted = await ctx.service.delete(entry.id);
  expect(deleted).toBe(true);

  const deletedAgain = await ctx.service.delete(entry.id);
  expect(deletedAgain).toBe(false);

  const nonExistent = await ctx.service.delete('00000000-0000-0000-0000-000000000000');
  expect(nonExistent).toBe(false);
});

test('listRecent returns ordered by createdAt DESC', async () => {
  const e1 = await factory.knowledge({ content: 'Recent test entry first' });
  await new Promise((r) => setTimeout(r, 10)); // ensure different timestamps
  const e2 = await factory.knowledge({ content: 'Recent test entry second' });
  await new Promise((r) => setTimeout(r, 10));
  const e3 = await factory.knowledge({ content: 'Recent test entry third' });

  const recent = await ctx.service.listRecent(50);
  const ids = recent.map((e) => e.id);
  const i1 = ids.indexOf(e1.id);
  const i2 = ids.indexOf(e2.id);
  const i3 = ids.indexOf(e3.id);

  // Most recent first: e3 before e2 before e1
  expect(i3).toBeLessThan(i2);
  expect(i2).toBeLessThan(i1);
});

test('listTags returns all unique tags', async () => {
  await factory.knowledge({ tags: ['list-tags-aaa'] });
  await factory.knowledge({ tags: ['list-tags-bbb'] });
  await factory.knowledge({ tags: ['list-tags-aaa', 'list-tags-ccc'] });

  const tags = await ctx.service.listTags();
  expect(tags).toContain('list-tags-aaa');
  expect(tags).toContain('list-tags-bbb');
  expect(tags).toContain('list-tags-ccc');
});

test('topTags returns sorted by frequency', async () => {
  await factory.knowledge({ tags: ['freq-top-a'] });
  await factory.knowledge({ tags: ['freq-top-a'] });
  await factory.knowledge({ tags: ['freq-top-a'] });
  await factory.knowledge({ tags: ['freq-top-b'] });
  await factory.knowledge({ tags: ['freq-top-b'] });
  await factory.knowledge({ tags: ['freq-top-c'] });

  const topTags = await ctx.service.topTags(50);
  const freqA = topTags.find((t) => t.tag === 'freq-top-a');
  const freqB = topTags.find((t) => t.tag === 'freq-top-b');
  const freqC = topTags.find((t) => t.tag === 'freq-top-c');

  expect(freqA).toBeDefined();
  expect(freqB).toBeDefined();
  expect(freqC).toBeDefined();
  expect(freqA!.count).toBeGreaterThanOrEqual(3);
  expect(freqB!.count).toBeGreaterThanOrEqual(2);
  expect(freqC!.count).toBeGreaterThanOrEqual(1);
  expect(freqA!.count).toBeGreaterThanOrEqual(freqB!.count);
  expect(freqB!.count).toBeGreaterThanOrEqual(freqC!.count);
});

test('getStats returns correct counts', async () => {
  const stats = await ctx.service.getStats();
  expect(stats.total).toBeGreaterThan(0);
  expect(stats.byType).toBeDefined();
  expect(Array.isArray(stats.byType)).toBe(true);
  expect(stats.byScope).toBeDefined();
  expect(Array.isArray(stats.byScope)).toBe(true);
  for (const item of stats.byType) {
    expect(item.type).toBeTruthy();
    expect(typeof item.count).toBe('number');
  }
});

test('countByType returns correct counts', async () => {
  // Ensure at least one of each type we want to check
  await factory.knowledge({ type: KnowledgeType.PATTERN, tags: ['type-count-test'] });
  await factory.knowledge({ type: KnowledgeType.DECISION, tags: ['type-count-test'] });

  const stats = await ctx.service.getStats();
  const byType = stats.byType;

  const patternCount = byType.find((t) => t.type === 'pattern');
  const decisionCount = byType.find((t) => t.type === 'decision');
  expect(patternCount).toBeDefined();
  expect(decisionCount).toBeDefined();
  expect(patternCount!.count).toBeGreaterThan(0);
  expect(decisionCount!.count).toBeGreaterThan(0);
});

test('entry version increments on each update', async () => {
  const entry = await factory.knowledge({ title: 'Version Test' });
  expect(entry.version).toBe(1);

  const v2 = await ctx.service.update(entry.id, { title: 'Version Test v2' });
  expect(v2!.version).toBe(2);

  const v3 = await ctx.service.update(entry.id, { title: 'Version Test v3' });
  expect(v3!.version).toBe(3);

  const v4 = await ctx.service.update(entry.id, { title: 'Version Test v4' });
  expect(v4!.version).toBe(4);
});
