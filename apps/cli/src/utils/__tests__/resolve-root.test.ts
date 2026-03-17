import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { resolvePackageRoot, resolveProjectRoot, resolveTemplatesDir } from '../resolve-root.js';

describe('resolvePackageRoot', () => {
  it('finds the CLI package root directory', () => {
    const root = resolvePackageRoot();
    expect(root).toBeDefined();
    expect(root).toContain('apps/cli');
    expect(existsSync(resolve(root, 'package.json'))).toBe(true);
  });

  it('found package.json has correct name', () => {
    const root = resolvePackageRoot();
    const pkg = JSON.parse(
      require('node:fs').readFileSync(resolve(root, 'package.json'), 'utf-8')
    );
    expect(pkg.name).toBe('@ai-knowledge/cli');
  });

  it('throws when starting from a directory with no matching package.json', () => {
    expect(() => resolvePackageRoot('/tmp')).toThrow('Could not find @ai-knowledge/cli package root');
  });
});

describe('resolveProjectRoot', () => {
  it('returns repo root when running from the repository', () => {
    const root = resolveProjectRoot();
    expect(root).toBeDefined();
    expect(existsSync(resolve(root!, 'docker', 'docker-compose.yml'))).toBe(true);
  });

  it('returns undefined when starting from a directory outside the repo', () => {
    const result = resolveProjectRoot('/tmp');
    expect(result).toBeUndefined();
  });
});

describe('resolveTemplatesDir', () => {
  it('resolves from package root when no projectRoot given (npx context)', () => {
    const dir = resolveTemplatesDir();
    expect(dir).toContain('templates');
    expect(existsSync(dir)).toBe(true);
  });

  it('resolves from repo when projectRoot given (dev context)', () => {
    const projectRoot = resolveProjectRoot();
    if (!projectRoot) return; // Skip if not in repo
    const dir = resolveTemplatesDir(projectRoot);
    expect(dir).toContain(resolve(projectRoot, 'apps', 'cli', 'templates'));
    expect(existsSync(dir)).toBe(true);
  });
});
