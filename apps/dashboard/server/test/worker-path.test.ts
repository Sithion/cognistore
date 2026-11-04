import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkerUrlResolver } from '../worker-path.js';

let tempDir: string | undefined;

function makeLayout() {
  tempDir = mkdtempSync(join(tmpdir(), 'cognistore-worker-path-'));
  const appDir = join(tempDir, 'app', 'dist-server');
  const coreDist = join(tempDir, 'node_modules', '@cognistore', 'core', 'dist');
  mkdirSync(appDir, { recursive: true });
  mkdirSync(join(coreDist, 'jobs'), { recursive: true });
  return { appDir, coreDist };
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('resolveWorkerUrl', () => {
  it('prefers the bundled worker beside the server module', () => {
    const { appDir, coreDist } = makeLayout();
    const bundledWorker = join(appDir, 'jobs', 'vacuum-worker.js');
    mkdirSync(join(appDir, 'jobs'));
    writeFileSync(bundledWorker, '');
    writeFileSync(join(coreDist, 'jobs', 'vacuum-worker.js'), '');

    const resolveWorker = createWorkerUrlResolver(
      pathToFileURL(join(appDir, 'index.js')).href,
      () => join(coreDist, 'index.js'),
      existsSync,
    );

    expect(resolveWorker('vacuum-worker').href).toBe(pathToFileURL(bundledWorker).href);
  });

  it('falls back to the core package dist jobs directory', () => {
    const { appDir, coreDist } = makeLayout();
    const packageWorker = join(coreDist, 'jobs', 'vacuum-worker.js');
    writeFileSync(packageWorker, '');
    const resolveWorker = createWorkerUrlResolver(
      pathToFileURL(join(appDir, 'index.js')).href,
      () => join(coreDist, 'index.js'),
      path => path === packageWorker,
    );

    expect(resolveWorker('vacuum-worker').href).toBe(pathToFileURL(packageWorker).href);
  });

  it('throws the named not-found error when neither layout contains the worker', () => {
    const { appDir, coreDist } = makeLayout();
    const resolveWorker = createWorkerUrlResolver(
      pathToFileURL(join(appDir, 'index.js')).href,
      () => join(coreDist, 'index.js'),
      () => false,
    );

    expect(() => resolveWorker('missing-worker')).toThrow('worker not found: missing-worker');
  });
});
