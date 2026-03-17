import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolvePackageRoot } from '../resolve-root.js';

describe('npm package contents', () => {
  const cliRoot = resolvePackageRoot();

  it('package.json files field includes dist and templates', () => {
    const pkg = JSON.parse(
      require('node:fs').readFileSync(resolve(cliRoot, 'package.json'), 'utf-8')
    );
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('templates');
  });

  it('npm pack --dry-run includes all required files', () => {
    const output = execSync('npm pack --dry-run --json 2>/dev/null', {
      cwd: cliRoot,
      encoding: 'utf-8',
    });

    const parsed = JSON.parse(output);
    const files = parsed[0].files.map((f: { path: string }) => f.path);

    // Templates must be included
    expect(files.some((f: string) => f.includes('templates/docker-compose.yml'))).toBe(true);
    expect(files.some((f: string) => f.includes('templates/init/001-schema.sql'))).toBe(true);
    expect(files.some((f: string) => f.includes('templates/.env.example'))).toBe(true);
    expect(files.some((f: string) => f.includes('templates/skills/'))).toBe(true);

    // Dist must be included
    expect(files.some((f: string) => f.includes('dist/'))).toBe(true);
  });
});
