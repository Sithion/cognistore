import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
export function createWorkerUrlResolver(
  moduleUrl: string,
  resolveCoreEntry: () => string,
  fileExists: (path: string) => boolean,
): (name: string) => URL {
  const resolvedWorkers = new Map<string, URL>();
  return (name: string): URL => {
    const cached = resolvedWorkers.get(name);
    if (cached) return cached;

    const bundledCandidate = new URL(`./jobs/${name}.js`, moduleUrl);
    if (fileExists(fileURLToPath(bundledCandidate))) {
      resolvedWorkers.set(name, bundledCandidate);
      return bundledCandidate;
    }

    const packageCandidate = pathToFileURL(join(dirname(resolveCoreEntry()), 'jobs', `${name}.js`));
    if (fileExists(fileURLToPath(packageCandidate))) {
      resolvedWorkers.set(name, packageCandidate);
      return packageCandidate;
    }

    throw new Error(`worker not found: ${name}`);
  };
}

/** Resolve a worker in either the bundled sidecar or the core package build. */
export const resolveWorkerUrl = createWorkerUrlResolver(
  import.meta.url,
  () => {
    try {
      return require.resolve('@cognistore/core');
    } catch {
      // The package currently exposes only its ESM entry in `exports`.
      return fileURLToPath(import.meta.resolve('@cognistore/core'));
    }
  },
  existsSync,
);
