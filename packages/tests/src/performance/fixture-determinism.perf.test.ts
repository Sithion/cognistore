import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { generateFixture, generateTokenJsonlDir } from './fixtures/generate-fixture.js';

// Plan v2.6 item 0.3 — the perf fixture must be reproducible, or baselines mean nothing.

const SMALL = { entries: 300, tokenRows: 2_000, opsRows: 500, seed: 7 };

function digest(path: string) {
  const db = new BetterSqlite3(path, { readonly: true });
  try {
    const rows = db.prepare('SELECT id, title, content, tags, scope, created_at FROM knowledge_entries ORDER BY id').all();
    const tokens = db.prepare('SELECT id, model, occurred_at, input_tokens FROM token_usage ORDER BY id').all();
    const counts = {
      entries: rows.length,
      tokens: tokens.length,
      ops: (db.prepare('SELECT count(*) AS n FROM operations_log').get() as { n: number }).n,
    };
    const hash = createHash('sha256').update(JSON.stringify([rows, tokens])).digest('hex');
    return { counts, hash };
  } finally {
    db.close();
  }
}

let dir: string;
test.beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cognistore-perf-det-')); });
test.afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test.describe('@perf fixture determinism (0.3)', () => {
  test('same seed yields identical content; another seed differs', () => {
    const a = generateFixture(join(dir, 'a.db'), SMALL);
    const b = generateFixture(join(dir, 'b.db'), SMALL);
    generateFixture(join(dir, 'c.db'), { ...SMALL, seed: 8 });
    expect(a.duplicateClusters).toBe(b.duplicateClusters);
    expect(a.duplicateMembers).toBeGreaterThanOrEqual(Math.round(SMALL.entries * 0.05) - 1);
    const da = digest(join(dir, 'a.db'));
    expect(da.counts).toEqual({ entries: 300, tokens: 2_000, ops: 500 });
    expect(digest(join(dir, 'b.db')).hash).toBe(da.hash);
    expect(digest(join(dir, 'c.db')).hash).not.toBe(da.hash);
  });

  test('token JSONL tree is reproducible and counts usage lines', () => {
    const one = generateTokenJsonlDir(join(dir, 'one'), { projects: 2, filesPerProject: 3, linesPerFile: 9 });
    const two = generateTokenJsonlDir(join(dir, 'two'), { projects: 2, filesPerProject: 3, linesPerFile: 9 });
    expect(one).toEqual({ files: 6, usageLines: 36 });
    expect(two).toEqual(one);
  });
});
