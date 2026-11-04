import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function sweepStaleExports(maxAgeMs = 10 * 60_000, baseDir = tmpdir()): Promise<void> {
  let names: string[];
  try { names = await readdir(baseDir); } catch { return; }
  await Promise.all(names.filter((name) => name.startsWith('cognistore-export-')).map(async (name) => {
    const path = join(baseDir, name);
    try {
      const info = await stat(path);
      if (info.isDirectory() && Date.now() - info.mtimeMs > maxAgeMs) await rm(path, { recursive: true, force: true });
    } catch { /* stale export cleanup is best effort */ }
  }));
}
