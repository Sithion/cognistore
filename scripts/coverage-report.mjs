#!/usr/bin/env node
/**
 * Per-package coverage report and gate (plan v2.6, T.1 + T.13).
 *
 *   node scripts/coverage-report.mjs [--markdown <file>] [--write-baseline]
 *
 * Reads the json-summary reports of the two layers:
 *   - integration: `pnpm coverage:integration` — the Playwright suites under c8,
 *     including the sidecar and MCP processes they spawn (NODE_V8_COVERAGE is
 *     inherited). Filtered on the built `dist` files, then source-mapped back to
 *     `src`; the MCP server is a single bundle, so it is reported as one row
 *     ("mcp-server (bundle)") that also contains the code it inlines.
 *   - unit: `pnpm --filter @cognistore/core test:coverage` and the same for the
 *     dashboard server (Vitest, v8).
 * Prints one row per package and layer. With a baseline file
 * (coverage-baseline.json) it fails when any row drops more than TOLERANCE
 * points below it, or measures under half the lines the baseline recorded (a
 * source map that failed to load shows every file as 1 covered line, i.e. a
 * vacuous 100%); --write-baseline records the current numbers instead. A
 * missing baseline fails too, so deleting it cannot switch the gate off.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'coverage-baseline.json');
const TOLERANCE = 0.5; // points: V8 counts shift slightly between runs and Node versions

const SOURCES = [
  { layer: 'integration', file: 'coverage/integration/coverage-summary.json' },
  { layer: 'unit', file: 'packages/core/coverage/coverage-summary.json' },
  { layer: 'unit', file: 'apps/dashboard/coverage/coverage-summary.json' },
];

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

function packageOf(file) {
  const rel = relative(ROOT, file);
  let m = rel.match(/^packages\/([^/]+)\//);
  if (m) return m[1];
  if (rel.startsWith('apps/dashboard/')) return 'dashboard-server';
  if (rel.startsWith('apps/mcp-server/')) return 'mcp-server (bundle)';
  return rel;
}

const rows = {};
for (const { layer, file } of SOURCES) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  const summary = JSON.parse(readFileSync(path, 'utf-8'));
  for (const [f, v] of Object.entries(summary)) {
    if (f === 'total') continue;
    const key = `${layer}: ${packageOf(f)}`;
    const r = (rows[key] ??= { lt: 0, lc: 0, bt: 0, bc: 0 });
    r.lt += v.lines.total; r.lc += v.lines.covered; r.bt += v.branches.total; r.bc += v.branches.covered;
  }
}
if (!Object.keys(rows).length) {
  console.error('no coverage summaries found — run the coverage commands first');
  process.exit(2);
}

const pct = (c, t) => (t ? Math.round((1000 * c) / t) / 10 : 100);
const current = Object.fromEntries(Object.entries(rows).sort().map(([k, r]) => [k, { lines: pct(r.lc, r.lt), branches: pct(r.bc, r.bt), lineTotal: r.lt }]));

if (args.includes('--write-baseline')) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`baseline written: ${relative(ROOT, BASELINE)}`);
}

const writing = args.includes('--write-baseline');
const failures = [];
if (!writing && !existsSync(BASELINE)) failures.push(`${relative(ROOT, BASELINE)} is missing (run with --write-baseline to create it)`);
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf-8')) : {};
const lines = ['| Layer: package | Lines | Branches | Baseline (L / B) | |', '|---|---:|---:|---:|---|'];
for (const [key, c] of Object.entries(current)) {
  const b = baseline[key];
  let status = b ? '✅' : '—';
  if (b && (c.lines < b.lines - TOLERANCE || c.branches < b.branches - TOLERANCE)) {
    status = '❌';
    failures.push(`${key}: ${c.lines}% / ${c.branches}% is below the baseline ${b.lines}% / ${b.branches}%`);
  }
  if (b?.lineTotal && c.lineTotal < b.lineTotal / 2) {
    status = '❌';
    failures.push(`${key}: only ${c.lineTotal} lines measured, the baseline had ${b.lineTotal} (source maps not loaded?)`);
  }
  lines.push(`| ${key} | ${c.lines}% | ${c.branches}% | ${b ? `${b.lines}% / ${b.branches}%` : 'none'} | ${status} |`);
}
for (const key of Object.keys(baseline)) {
  if (!(key in current)) failures.push(`${key}: in the baseline but not measured (did a coverage step not run?)`);
}

const table = lines.join('\n');
console.log(table);
const md = opt('--markdown');
if (md) {
  mkdirSync(dirname(resolve(md)), { recursive: true });
  const why = failures.length && !writing ? `\n**Gate failed:**\n\n- ${failures.join('\n- ')}\n` : '';
  writeFileSync(md, `## Coverage\n\n${table}\n${why}`);
}
if (failures.length && !writing) {
  console.error(`\ncoverage dropped below the baseline (tolerance ${TOLERANCE} pt):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
