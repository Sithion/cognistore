import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The sidecar scans homedir()/.claude/projects at startup (token usage), so a
// test that spawns it must sandbox HOME, not only COGNISTORE_HOME (plan B.5).
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.test.ts') ? [p] : [];
  });
}

test('every test that spawns the sidecar sets HOME', () => {
  const offenders = walk(SRC).filter((f) => {
    const text = readFileSync(f, 'utf8');
    const spawnsSidecar = /spawnSidecar\(|\[SERVER_ENTRY\]/.test(text);
    return spawnsSidecar && !/\bHOME:/.test(text.replace(/COGNISTORE_HOME:/g, ''));
  });
  expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
});
