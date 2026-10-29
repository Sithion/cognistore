#!/usr/bin/env node
/**
 * One command for "is this branch good?" (plan v2.6, T.12). CI's build-and-test
 * job and the pre-push hook run exactly this.
 *
 *   pnpm verify                 # lint, type-check, build, unit, integration, knip
 *   pnpm verify --coverage      # same, under V8 coverage, then the baseline gate
 *   pnpm verify --coverage --markdown <file>   # also write the coverage table
 *
 * Steps, in order, stopping at the first failure:
 *   lint        Biome (biome.json): errors fail, the warnings are the recorded baseline
 *   type-check  turbo type-check (dashboard frontend + server, MCP server, tests)
 *   build       turbo build (the suites spawn the built sidecar and MCP server)
 *   unit        Vitest: packages/core and the sidecar's auth/settings
 *   scripts     node:test for the root tooling scripts (scripts/test/)
 *   integration Playwright projects e2e, load and compat: the API inventory, the
 *               MCP contract and MCP x DB matrix, and the upgrade matrix
 *   knip        unused files, exports and dependencies (knip.json)
 *   coverage    with --coverage: scripts/coverage-report.mjs against
 *               coverage-baseline.json. It also runs when unit or integration
 *               failed, so the table shows what was measured; verify still fails.
 * The @perf suite is not part of it; CI runs it in its own job.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const coverage = args.includes('--coverage');
const mdIndex = args.indexOf('--markdown');
const markdown = mdIndex >= 0 ? args[mdIndex + 1] : undefined;

const steps = [
  ['lint', ['pnpm', 'lint']],
  ['type-check', ['pnpm', 'type-check']],
  ['build', ['pnpm', 'build']],
  ['unit', coverage ? ['pnpm', 'coverage:unit'] : ['pnpm', '--filter', '@cognistore/core', '--filter', '@cognistore/dashboard', 'test']],
  ['scripts', ['pnpm', 'test:scripts']],
  ['integration', coverage ? ['pnpm', 'coverage:integration'] : ['pnpm', '--filter', '@cognistore/tests', 'test']],
  ['knip', ['pnpm', 'knip']],
];
if (coverage) steps.push(['coverage', ['node', 'scripts/coverage-report.mjs', ...(markdown ? ['--markdown', markdown] : [])]]);

const timings = [];
function run(name, [cmd, ...rest]) {
  console.log(`\n▶ verify: ${name} — ${[cmd, ...rest].join(' ')}`);
  const started = Date.now();
  const { status, signal, error } = spawnSync(cmd, rest, { cwd: ROOT, stdio: 'inherit' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  timings.push(`${name} ${secs}s`);
  if (status === 0) return 0;
  const why = error ? ` (${error.message})` : signal ? ` (killed by ${signal})` : '';
  console.error(`\n✖ verify: ${name} failed${why} after ${secs}s`);
  return status || 1;
}

for (const [name, command] of steps) {
  const status = run(name, command);
  if (status === 0) continue;
  // Still print the coverage of what ran, so a red CI run shows the table.
  if (coverage && (name === 'unit' || name === 'integration')) run('coverage (report only)', steps.at(-1)[1]);
  process.exit(status);
}
console.log(`\n✔ verify passed: ${timings.join(', ')}`);
