#!/usr/bin/env node
/**
 * Remove what builds and test runs leave at the repo root and outside the
 * packages' own `clean` scripts (plan v2.6, L.7). `pnpm clean` runs
 * `turbo clean` (each package's dist) first, then this.
 *
 * The list is fixed and literal: no globs, and symlinks are removed as links,
 * never followed. It refuses to run outside this repo's root.
 */
import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PATHS = [
  'coverage',
  'apps/dashboard/coverage',
  'packages/core/coverage',
  'packages/tests/playwright-report',
  'packages/tests/test-results',
  'playwright-report',
  'test-results',
  'packages/core/.stryker-tmp',
  'apps/dashboard/sidecar-bundle',
  '.turbo',
];

let name;
try {
  name = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;
} catch {}
if (name !== 'cognistore') {
  console.error(`clean: ${ROOT} is not the cognistore repo root — nothing removed`);
  process.exit(1);
}

let removed = 0;
for (const rel of PATHS) {
  const abs = join(ROOT, rel);
  try {
    lstatSync(abs);
  } catch {
    continue;
  }
  // rmSync does not follow symlinks: a linked path is unlinked, not its target.
  rmSync(abs, { recursive: true, force: true });
  console.log(`clean: removed ${rel}`);
  removed++;
}
console.log(`clean: ${removed} path(s) removed`);
