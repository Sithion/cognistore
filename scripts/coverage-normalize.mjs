#!/usr/bin/env node
/**
 * Remove stale source-map-cache entries from V8 coverage dumps.
 * Playwright's transforming loader can record line lengths for transformed
 * package files; c8 uses the last dump's cache entry, which can break remapping.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function normalizeDumps(dir) {
  if (!dir || !existsSync(dir)) return { dumps: 0, dropped: 0, touched: 0 };

  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  const lineLengthsByUrl = new Map();
  let dumps = 0;
  let dropped = 0;
  let touched = 0;

  for (const name of files) {
    const path = join(dir, name);
    const dump = JSON.parse(readFileSync(path, 'utf8'));
    const cache = dump['source-map-cache'];
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) continue;
    dumps++;

    const stale = [];
    for (const [url, entry] of Object.entries(cache)) {
      if (!url.startsWith('file:') || !Array.isArray(entry?.lineLengths)) continue;
      let actual = lineLengthsByUrl.get(url);
      if (actual === undefined) {
        try {
          actual = readFileSync(fileURLToPath(url), 'utf8').split('\n').map((line) => line.length).join(',');
        } catch {
          continue;
        }
        lineLengthsByUrl.set(url, actual);
      }
      if (entry.lineLengths.join(',') !== actual) stale.push(url);
    }

    if (stale.length) {
      for (const url of stale) delete cache[url];
      const staleSet = new Set(stale);
      if (Array.isArray(dump.result)) dump.result = dump.result.filter((item) => !staleSet.has(item?.url));
      writeFileSync(path, JSON.stringify(dump));
      dropped += stale.length;
      touched++;
    }
  }

  return { dumps, dropped, touched };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error('usage: node scripts/coverage-normalize.mjs <v8-dump-dir>');
    process.exit(2);
  }
  const { dumps, dropped, touched } = normalizeDumps(process.argv[2]);
  console.log(`coverage-normalize: dropped ${dropped} transformed-source entries from ${touched} of ${dumps} dumps`);
}
