import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Walk up from a starting directory to find the nearest package.json
 * with name === "@ai-knowledge/cli". Returns the directory containing it.
 *
 * Works in both source (tsx dev) and bundled (dist/index.js) contexts
 * because it searches upward rather than using hardcoded relative paths.
 */
export function resolvePackageRoot(startDir?: string): string {
  let dir = startDir ?? dirname(fileURLToPath(import.meta.url));
  const root = resolve('/');

  while (dir !== root) {
    const pkgPath = resolve(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === '@ai-knowledge/cli') {
          return dir;
        }
      } catch {
        // Malformed package.json — keep walking
      }
    }
    dir = dirname(dir);
  }

  throw new Error(
    'Could not find @ai-knowledge/cli package root. ' +
    'This is a bug — please report it at https://github.com/<YOUR_USERNAME>/knowledge-base/issues'
  );
}

/**
 * Detect the monorepo root by checking if `docker/docker-compose.yml`
 * exists two directories above the CLI package root (apps/cli/ → apps/ → repo root).
 *
 * Returns the repo root path when running from a cloned repository,
 * or undefined when running via npx (no repo structure available).
 */
export function resolveProjectRoot(startDir?: string): string | undefined {
  try {
    const packageRoot = resolvePackageRoot(startDir);
    // In the monorepo: apps/cli/ → apps/ → repo root
    const candidate = resolve(packageRoot, '..', '..');
    if (existsSync(resolve(candidate, 'docker', 'docker-compose.yml'))) {
      return candidate;
    }
  } catch {
    // Package root not found — definitely not in repo
  }
  return undefined;
}

/**
 * Resolve the templates directory.
 *
 * - If projectRoot is provided (repo context): templates are at
 *   <projectRoot>/apps/cli/templates/ for skills and <projectRoot>/docker/ for docker files.
 *   Returns the CLI templates dir.
 * - If projectRoot is undefined (npx context): templates are bundled
 *   inside the package at <packageRoot>/templates/
 */
export function resolveTemplatesDir(projectRoot?: string, startDir?: string): string {
  if (projectRoot) {
    return resolve(projectRoot, 'apps', 'cli', 'templates');
  }
  const packageRoot = resolvePackageRoot(startDir);
  return resolve(packageRoot, 'templates');
}
