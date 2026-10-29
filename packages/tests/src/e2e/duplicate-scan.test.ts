import { KnowledgeType } from '@cognistore/shared';
import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDbClient,
  KnowledgeRepository,
  KnowledgeService,
  readEmbeddingsChunked,
  scanDuplicatePairs,
  findPairsInVectors,
  normalizeRows,
  dupScanStateKey,
  invalidateDuplicateScan,
  readEmbeddingsByLookup,
  DUP_PAIR_CAP,
  type SQLiteDatabase,
} from '@cognistore/core';
import { copyFixture, ensureFixture } from '../performance/fixtures/generate-fixture.js';
import { hashEmbedder } from '../performance/fixtures/perf-helpers.js';
import { legacyDuplicateGroups, expectSameGroups } from '../performance/fixtures/legacy-duplicates.js';

/**
 * Plan v2.6 items 1C.2 + 1C.3 — the cooperative duplicate scan must return the
 * SAME groups as the per-entry KNN algorithm it replaces, and its incremental
 * mode must match a full scan after adds, edits and deletes.
 *
 * Runs on a 2,000-entry seeded fixture (the 10k one is for @perf): the legacy
 * reference costs ~2 s there.
 */

const SMALL = { entries: 2000, tokenRows: 1000, opsRows: 1000 };

let dir: string;
let sqlite: SQLiteDatabase;
let repo: KnowledgeRepository;

test.describe.serial('duplicate scan (1C.2 + 1C.3)', () => {
  test.beforeAll(() => {
    test.setTimeout(180_000);
    const fixture = ensureFixture(SMALL);
    dir = mkdtempSync(join(tmpdir(), 'cognistore-dupscan-'));
    const client = createDbClient(copyFixture(fixture.path, dir));
    sqlite = client.sqlite;
    repo = new KnowledgeRepository(client.db, sqlite);
  });

  test.afterAll(() => {
    try { sqlite?.close(); } catch { /* already closed */ }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('chunked reader returns exactly the vectors the virtual table returns', () => {
    const vtab = new Map(
      (sqlite.prepare('SELECT id, embedding FROM knowledge_embeddings').all() as { id: string; embedding: Buffer }[])
        .map((r) => [r.id, Buffer.from(r.embedding)]),
    );
    let count = 0;
    for (const chunk of readEmbeddingsChunked(sqlite)) {
      chunk.ids.forEach((id, i) => {
        const mine = Buffer.from(chunk.vectors.buffer, chunk.vectors.byteOffset + i * chunk.dims * 4, chunk.dims * 4);
        expect(mine.equals(vtab.get(id)!)).toBe(true);
        count++;
      });
    }
    expect(count).toBe(vtab.size);
    expect(count).toBe(SMALL.entries);
  });

  test('same groups as the legacy per-entry KNN algorithm', async () => {
    test.setTimeout(120_000);
    const expected = await legacyDuplicateGroups(repo, sqlite);
    invalidateDuplicateScan(sqlite);
    const actual = await repo.findDuplicateGroups({ limit: 100_000 });
    expect(expected.length).toBeGreaterThan(20); // the fixture plants clusters
    expectSameGroups(actual, expected);
    // The public limit/order contract on top: the first 100, size DESC then similarity DESC.
    const limited = await repo.findDuplicateGroups();
    expect(limited.map((g) => g.groupId)).toEqual(actual.slice(0, 100).map((g) => g.groupId));
  });

  test('incremental scan matches a full scan after an add, an edit and a delete', async () => {
    const full = () => scanDuplicatePairs(sqlite, 0.9, { incremental: false });
    const groupsOf = async (r: Awaited<ReturnType<typeof full>>) => {
      const { groupPairs } = await import('@cognistore/core');
      return groupPairs(r.pairs, r.meta, 100_000);
    };
    await full(); // seeds the state

    // Add: a near-copy of an entry that is in no cluster yet.
    const loner = (sqlite.prepare(`SELECT id FROM knowledge_entries ORDER BY id LIMIT 1 OFFSET 7`).get() as { id: string }).id;
    const base = sqlite.prepare('SELECT embedding FROM knowledge_embeddings WHERE id = ?').get(loner) as { embedding: Buffer };
    const vec = Array.from(new Float32Array(base.embedding.buffer, base.embedding.byteOffset, base.embedding.byteLength / 4));
    const copy = vec.map((v, i) => v + (i % 7 === 0 ? 0.001 : 0));
    const added = await repo.create({ title: 'near copy', content: 'near copy', tags: ['dup'], type: KnowledgeType.PATTERN, scope: 'global', source: 'test', embedding: copy });

    let inc = await scanDuplicatePairs(sqlite, 0.9);
    expect(inc.mode).toBe('incremental');
    expect(inc.compared).toBeLessThan(10);
    expect(inc.pairs.some((p) => [p.a, p.b].includes(added.id) && [p.a, p.b].includes(loner))).toBe(true);
    expectSameGroups(await groupsOf(inc), await groupsOf(await full()));

    // Edit: move the copy away (new vector + updated_at), as KnowledgeService.update does.
    const far = vec.map((v, i) => (i % 2 ? -v : v));
    sqlite.prepare('UPDATE knowledge_embeddings SET embedding = ? WHERE id = ?').run(Buffer.from(new Float32Array(far).buffer), added.id);
    sqlite.prepare('UPDATE knowledge_entries SET updated_at = ? WHERE id = ?').run(new Date(Date.now() + 1000).toISOString(), added.id);
    inc = await scanDuplicatePairs(sqlite, 0.9);
    expect(inc.mode).toBe('incremental');
    expect(inc.pairs.some((p) => [p.a, p.b].includes(added.id))).toBe(false);
    expectSameGroups(await groupsOf(inc), await groupsOf(await full()));

    // Delete: a member of a planted cluster disappears from its group.
    const victim = inc.pairs[0].a;
    await repo.delete(victim);
    inc = await scanDuplicatePairs(sqlite, 0.9);
    expect(inc.mode).toBe('incremental');
    expect(inc.pairs.some((p) => p.a === victim || p.b === victim)).toBe(false);
    expectSameGroups(await groupsOf(inc), await groupsOf(await full()));
  });

  test('falls back to a full scan on a corrupt state or a new threshold', async () => {
    sqlite.prepare('INSERT INTO cleanup_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(dupScanStateKey(0.9), '{not json');
    expect((await scanDuplicatePairs(sqlite, 0.9)).mode).toBe('full');
    expect((await scanDuplicatePairs(sqlite, 0.9)).mode).toBe('incremental');
    expect((await scanDuplicatePairs(sqlite, 0.95)).mode).toBe('full');
    // Both thresholds are kept.
    expect((await scanDuplicatePairs(sqlite, 0.9)).mode).toBe('incremental');
  });

  test('the lookup fallback reads the same vectors as the chunked reader', () => {
    const chunked = new Map<string, Buffer>();
    for (const c of readEmbeddingsChunked(sqlite)) c.ids.forEach((id, i) => chunked.set(id, Buffer.from(c.vectors.buffer, c.vectors.byteOffset + i * c.dims * 4, c.dims * 4)));
    let count = 0;
    for (const c of readEmbeddingsByLookup(sqlite)) {
      expect(c.rowids).toBeNull();
      c.ids.forEach((id, i) => {
        expect(Buffer.from(c.vectors.buffer, c.vectors.byteOffset + i * c.dims * 4, c.dims * 4).equals(chunked.get(id)!)).toBe(true);
        count++;
      });
    }
    expect(count).toBe(chunked.size);
  });

  test('an unchanged base does not rewrite the state', async () => {
    await scanDuplicatePairs(sqlite, 0.9);
    const changes = () => (sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    const again = await scanDuplicatePairs(sqlite, 0.9);
    expect(again.mode).toBe('incremental');
    expect(again.compared).toBeLessThanOrEqual(2); // entries sharing the newest updated_at are re-checked
    expect(changes()).toBe(before);
  });

  test('concurrent scans of the same threshold share one run', async () => {
    const [x, y] = [scanDuplicatePairs(sqlite, 0.9), scanDuplicatePairs(sqlite, 0.9)];
    expect(x).toBe(y);
    await x;
  });

  test('re-embedding invalidates the incremental state', async () => {
    await scanDuplicatePairs(sqlite, 0.9);
    const has = () => !!sqlite.prepare('SELECT 1 FROM cleanup_meta WHERE key = ?').get(dupScanStateKey(0.9));
    expect(has()).toBe(true);
    // A throwaway service on the same handle (existing vectors make the inserts no-ops).
    const service = new KnowledgeService(repo, hashEmbedder);
    await service.reembedAll();
    expect(has()).toBe(false);
  });
});

test.describe('pair engine (unit)', () => {
  test('a dense cluster stops at the pair cap and keeps the event loop responsive', async () => {
    const n = 3000; const dims = 256;
    const vectors = new Float32Array(n * dims);
    for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) vectors[i * dims + d] = 1 + ((i * 31 + d) % 7) * 1e-4;
    const set = { ids: Array.from({ length: n }, (_, i) => `c-${String(i).padStart(5, '0')}`), vectors, dims };
    normalizeRows(set);
    let worst = 0;
    let last = performance.now();
    const probe = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 5); last = now; }, 5);
    const r = await findPairsInVectors(set, 0.9);
    clearInterval(probe);
    expect(r.truncated).toBe(true);
    expect(r.pairs).toHaveLength(DUP_PAIR_CAP);
    expect(worst).toBeLessThan(100);
  });

  test('pruning never drops a pair the brute force finds', async () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 - 0.5; };
    const n = 300; const dims = 256;
    const vectors = new Float32Array(n * dims);
    for (let i = 0; i < n; i++) {
      const src = i % 3 === 0 || i === 0 ? i : i - 1; // every row near its predecessor, most of the time
      for (let d = 0; d < dims; d++) vectors[i * dims + d] = src === i ? rand() : vectors[src * dims + d] + rand() * 0.05;
    }
    const ids = Array.from({ length: n }, (_, i) => `id-${String(i).padStart(4, '0')}`);
    const set = { ids, vectors, dims };
    normalizeRows(set);
    const brute: string[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += vectors[i * dims + d] * vectors[j * dims + d];
      if (dot >= 0.9) brute.push(`${ids[i]}|${ids[j]}`);
    }
    const found = (await findPairsInVectors(set, 0.9)).pairs.map((p) => `${p.a}|${p.b}`);
    expect(brute.length).toBeGreaterThan(50);
    expect(found.sort()).toEqual(brute.sort());
    // Incremental restricted to some rows = brute-force pairs touching those rows.
    const q = [1, 2, 50, 299];
    const qIds = new Set(q.map((i) => ids[i]));
    const inc = (await findPairsInVectors(set, 0.9, { queryRows: q })).pairs.map((p) => `${p.a}|${p.b}`);
    expect(inc.sort()).toEqual(brute.filter((k) => k.split('|').some((x) => qIds.has(x))).sort());
  });
});
