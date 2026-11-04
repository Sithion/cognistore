import { afterEach, describe, expect, it } from 'vitest';
import { makeDb } from './helpers.js';

describe('unit harness', () => {
  let ctx: ReturnType<typeof makeDb>;
  afterEach(() => ctx?.cleanup());

  it('adds an entry and finds it by search', async () => {
    ctx = makeDb();
    const added = await ctx.service.add({
      title: 'SQLite WAL', content: 'Use WAL mode with one writer.', tags: ['sqlite'], type: 'pattern' as any, scope: 'global', source: 'unit',
    });
    const hits = await ctx.service.search('WAL mode writer', {});
    expect(hits.map((h) => h.entry.id)).toContain(added.id);
  });
});
