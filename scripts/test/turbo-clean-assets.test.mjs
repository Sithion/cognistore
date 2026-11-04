import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));

// A turbo cache hit restores dist/ over the existing directory and never deletes
// extra files, so a stale migration from another branch would be applied.
test('core build is preceded by an uncached task that empties migrations and seeds', () => {
  const turbo = read('turbo.json').tasks;
  assert.equal(turbo['@cognistore/core#clean-assets'].cache, false);
  assert.ok(turbo['@cognistore/core#build'].dependsOn.includes('@cognistore/core#clean-assets'));
  assert.ok(turbo['@cognistore/core#build'].dependsOn.includes('^build'));
  const script = read('packages/core/package.json').scripts['clean-assets'];
  assert.match(script, /dist\/db\/migrations/);
  assert.match(script, /dist\/db\/seeds/);
});
