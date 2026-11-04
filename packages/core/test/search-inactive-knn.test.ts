import { afterEach, describe, expect, it } from 'vitest';
import { makeDb, stubEmbedding } from './helpers.js';

describe('searchBySimilarity with inactive nearest vectors', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => ctx?.cleanup());

  it('still returns active results when the nearest entries are not active', async () => {
    ctx = makeDb();
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const text = `alpha topic variant ${'x'.repeat(i % 7)} ${i}`;
      const e = await ctx.repository.create({
        title: `entry ${i}`, content: text, type: 'pattern', scope: 'project', source: 'test',
        tags: [], embedding: stubEmbedding(text),
      } as any);
      ids.push(e.id);
    }
    const query = stubEmbedding('alpha topic variant  0');
    const before = await ctx.repository.searchBySimilarity(query, { limit: 5, threshold: 0 });
    const nearest = before.map((h) => h.entry.id);
    expect(nearest.length).toBe(5);
    const states = ['superseded', 'archived', 'trashed'];
    nearest.concat(ids.filter((i) => !nearest.includes(i)).slice(0, 7)).forEach((id, i) => {
      ctx.sqlite.prepare('UPDATE knowledge_entries SET status = ? WHERE id = ?').run(states[i % 3], id);
    });
    const demoted = new Set(nearest.concat(ids.filter((i) => !nearest.includes(i)).slice(0, 7)));
    const after = await ctx.repository.searchBySimilarity(query, { limit: 5, threshold: 0 });
    expect(after.length).toBe(5);
    for (const h of after) expect(demoted.has(h.entry.id)).toBe(false);
  });
});
