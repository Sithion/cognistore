import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeDumps } from '../coverage-normalize.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cov-norm-'));
  const src = join(root, 'mod.js');
  writeFileSync(src, 'const a = 1;\nexport default a;\n'); // line lengths [12, 17, 0]
  const dumps = join(root, 'v8');
  mkdirSync(dumps);
  return { root, url: pathToFileURL(src).href, dumps };
}
function dump(dir, name, url, lineLengths) {
  const body = {
    result: [{ scriptId: '1', url, functions: [] }, { scriptId: '2', url: 'node:fs', functions: [] }],
    'source-map-cache': { [url]: { lineLengths, data: { version: 3, sources: [], mappings: '' }, url: null } },
  };
  writeFileSync(join(dir, name), JSON.stringify(body));
  return join(dir, name);
}

test('drops a cache entry whose line lengths differ from the file on disk, and its results', () => {
  const f = fixture();
  const p = dump(f.dumps, 'coverage-1-0.json', f.url, [99, 3]);
  assert.deepEqual(normalizeDumps(f.dumps), { dumps: 1, dropped: 1, touched: 1 });
  const out = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(out['source-map-cache'][f.url], undefined);
  assert.deepEqual(out.result.map((s) => s.url), ['node:fs']);
  rmSync(f.root, { recursive: true, force: true });
});

test('keeps a matching entry and leaves the file byte-identical', () => {
  const f = fixture();
  const p = dump(f.dumps, 'coverage-2-0.json', f.url, [12, 17, 0]);
  const before = readFileSync(p, 'utf8');
  assert.deepEqual(normalizeDumps(f.dumps), { dumps: 1, dropped: 0, touched: 0 });
  assert.equal(readFileSync(p, 'utf8'), before);
  rmSync(f.root, { recursive: true, force: true });
});

test('keeps entries whose file no longer exists', () => {
  const f = fixture();
  dump(f.dumps, 'coverage-3-0.json', pathToFileURL(join(f.root, 'gone.js')).href, [1]);
  assert.equal(normalizeDumps(f.dumps).dropped, 0);
  rmSync(f.root, { recursive: true, force: true });
});

test('keeps entries with a non-file URL', () => {
  const f = fixture();
  dump(f.dumps, 'coverage-4-0.json', 'node:internal/x', [1]);
  assert.equal(normalizeDumps(f.dumps).dropped, 0);
  rmSync(f.root, { recursive: true, force: true });
});

test('is idempotent: a second run drops nothing', () => {
  const f = fixture();
  dump(f.dumps, 'coverage-5-0.json', f.url, [99, 3]);
  normalizeDumps(f.dumps);
  assert.deepEqual(normalizeDumps(f.dumps), { dumps: 1, dropped: 0, touched: 0 });
  rmSync(f.root, { recursive: true, force: true });
});

test('a missing directory reports zeros', () => {
  assert.deepEqual(normalizeDumps(join(tmpdir(), 'cov-norm-does-not-exist')), { dumps: 0, dropped: 0, touched: 0 });
});
