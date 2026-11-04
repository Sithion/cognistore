import { expect } from '@playwright/test';
import type { KnowledgeRepository, SQLiteDatabase } from '@cognistore/core';

// Reference implementation for the plan v2.6 1C.3 equivalence tests: the
// duplicate grouping as it was before the cooperative scan replaced it.

type Member = { id: string; title: string; scope: string; type: string; version: number; updatedAt: string };
export type Group = { groupId: string; maxSimilarity: number; members: Member[] };

/** The pre-2.6 algorithm, verbatim in behaviour: listAll + one KNN (k = 20) per entry + union-find. */
export async function legacyDuplicateGroups(repo: KnowledgeRepository, sqlite: SQLiteDatabase, threshold = 0.9, limit = 100_000): Promise<Group[]> {
  const entries = await repo.listAll();
  const meta = new Map<string, Member>(entries.map((e) => [e.id, {
    id: e.id, title: e.title, scope: e.scope, type: e.type, version: (e as { version?: number }).version ?? 1, updatedAt: e.updatedAt,
  }]));
  const getVec = sqlite.prepare('SELECT embedding FROM knowledge_embeddings WHERE id = ?');
  const knn = sqlite.prepare('SELECT id, distance FROM knowledge_embeddings WHERE embedding MATCH ? AND k = ?');
  const pairs: { a: string; b: string; similarity: number }[] = [];
  for (const entry of entries) {
    const row = getVec.get(entry.id) as { embedding: Buffer } | undefined;
    if (!row) continue;
    for (const n of knn.all(row.embedding, 20) as { id: string; distance: number }[]) {
      if (entry.id >= n.id || !meta.has(n.id)) continue;
      const similarity = 1 - n.distance;
      if (similarity >= threshold) pairs.push({ a: entry.id, b: n.id, similarity });
    }
  }
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  for (const p of pairs) {
    for (const id of [p.a, p.b]) if (!parent.has(id)) parent.set(id, id);
    const ra = find(p.a); const rb = find(p.b);
    if (ra !== rb) parent.set(rb, ra);
  }
  const groups = new Map<string, Member[]>();
  for (const id of parent.keys()) {
    const r = find(id);
    groups.set(r, [...(groups.get(r) ?? []), meta.get(id)!]);
  }
  const maxSim = new Map<string, number>();
  for (const p of pairs) maxSim.set(find(p.a), Math.max(maxSim.get(find(p.a)) ?? 0, p.similarity));
  return [...groups.entries()].map(([root, members]) => {
    members.sort((a, b) => (b.version - a.version) || b.updatedAt.localeCompare(a.updatedAt));
    return { groupId: members.reduce((m, x) => (x.id < m ? x.id : m), members[0].id), maxSimilarity: maxSim.get(root) ?? 0, members };
  }).sort((x, y) => (y.members.length - x.members.length) || (y.maxSimilarity - x.maxSimilarity)).slice(0, limit);
}

export function expectSameGroups(actual: Group[], expected: Group[]) {
  const byId = (gs: Group[]) => new Map(gs.map((g) => [g.groupId, g]));
  const a = byId(actual);
  const e = byId(expected);
  expect([...a.keys()].sort()).toEqual([...e.keys()].sort());
  for (const [id, eg] of e) {
    const ag = a.get(id)!;
    expect(ag.members.map((m) => m.id)).toEqual(eg.members.map((m) => m.id));
    expect(Math.abs(ag.maxSimilarity - eg.maxSimilarity)).toBeLessThan(1e-5);
  }
}

