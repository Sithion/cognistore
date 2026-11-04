import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const path = new URL('../../apps/mcp-server/src/abi-recovery.ts', import.meta.url);
const js = ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { isAbiError, buildAbiErrorMessage, buildRebuildCommand, recoverAbi, rebuildPrefixFor, acquireRebuildLock } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const error = Object.assign(new Error(
  'NODE_MODULE_VERSION 127; this version of Node.js requires NODE_MODULE_VERSION 137',
), { code: 'ERR_DLOPEN_FAILED' });

test('classifies code, text, cause, cycles, and unrelated errors', () => {
  assert.equal(isAbiError({ code: 'ERR_DLOPEN_FAILED', message: 'wrong ELF class' }), false);
  assert.equal(isAbiError({ message: 'was compiled against a different Node.js version' }), true);
  assert.equal(isAbiError({ cause: error }), true);
  const cycle = { message: 'ordinary failure' };
  cycle.cause = cycle;
  assert.equal(isAbiError(cycle), false);
  assert.equal(isAbiError(new Error('SQLITE_BUSY')), false);
  const text = buildAbiErrorMessage(error, '/private/mcp');
  assert.ok(text.startsWith('CogniStore MCP: better-sqlite3 was built for a different Node.js version'));
  for (const expected of ['127', '137', 'npx clear-npx-cache',
    'npm rebuild better-sqlite3 --prefix /private/mcp']) assert.ok(text.includes(expected));
});

test('rebuild follows the failing runtime and strips inherited target overrides', () => {
  const env = { PATH: '/other/node/bin:/usr/bin', KEEP: 'yes', npm_config_target: '22', npm_config_runtime: 'electron', npm_config_disturl: 'https://invalid.example', npm_config_build_from_source: 'true', NPM_CONFIG_TARGET: '23' };
  const before = { ...env };
  const spec = buildRebuildCommand({ execPath: '/failing/node/bin/node', rebuildPrefix: '/private/mcp', env, siblingNpmExists: true });
  assert.equal(spec.command, '/failing/node/bin/npm');
  assert.deepEqual(spec.args, ['rebuild', 'better-sqlite3']);
  assert.equal(spec.cwd, '/private/mcp');
  assert.equal(spec.timeout, 120000);
  assert.equal(spec.shell, false);
  assert.equal(spec.env.PATH, '/failing/node/bin:/other/node/bin:/usr/bin');
  assert.equal(spec.env.KEEP, 'yes');
  assert.deepEqual(Object.keys(spec.env).sort(), ['KEEP', 'PATH']);
  assert.deepEqual(env, before);
  assert.equal(buildRebuildCommand({ execPath: '/failing/node/bin/node', rebuildPrefix: '/private/mcp', env, siblingNpmExists: false }).command, 'npm');
});

test('rebuild prefix finds the node_modules containing better-sqlite3', () => {
  assert.equal(rebuildPrefixFor('/c/_npx/h/node_modules/better-sqlite3/package.json'), '/c/_npx/h');
  assert.equal(rebuildPrefixFor('/p/node_modules/@cognistore/mcp-server/node_modules/better-sqlite3/package.json'), '/p/node_modules/@cognistore/mcp-server');
  assert.equal(rebuildPrefixFor('/r/node_modules/.pnpm/better-sqlite3@12.0.0/node_modules/better-sqlite3/package.json'), '/r/node_modules/.pnpm/better-sqlite3@12.0.0');
});

test('rebuild lock acquires, waits for contention, and removes stale locks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cognistore-abi-lock-'));
  try {
    const first = await acquireRebuildLock(dir);
    assert.equal(first.acquired, true);
    let released = false;
    const waiting = acquireRebuildLock(dir, { timeoutMs: 2000, sleep: async () => { if (!released) { released = true; first.release(); } } });
    const second = await waiting;
    assert.equal(second.acquired, true);
    second.release();
    const lockPath = join(dir, '.cognistore-abi-rebuild.lock');
    const fd = openSync(lockPath, 'wx'); closeSync(fd);
    const old = new Date(Date.now() - 181000);
    utimesSync(lockPath, old, old);
    const stale = await acquireRebuildLock(dir);
    assert.equal(stale.acquired, true);
    stale.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one rebuild, fresh guarded process, inherited stdio, exact exit propagation', async () => {
  const lockDir = mkdtempSync(join(tmpdir(), 'cognistore-recovery-'));
  const calls = [];
  const stderr = [];
  const deps = { rebuildPrefix: lockDir, execPath: '/runtime/node', execArgv: ['--no-warnings'], argv: ['/runtime/node', '/private/mcp/dist/index.js', '--arg'], env: { PATH: '/usr/bin' }, siblingNpmExists: false,
    rebuild: async (spec) => { calls.push(['rebuild', spec]); }, respawn: async (spec) => { calls.push(['respawn', spec]); return 23; }, stderr: (text) => stderr.push(text) };
  assert.equal(await recoverAbi(error, deps), 23);
  assert.deepEqual(calls.map(([kind]) => kind), ['rebuild', 'respawn']);
  assert.deepEqual(calls[1][1], { command: '/runtime/node', args: ['--no-warnings', '/private/mcp/dist/index.js', '--arg'], env: { PATH: '/usr/bin', COGNISTORE_ABI_REBUILT: '1' }, stdio: 'inherit' });
  calls.length = 0;
  try { unlinkSync(join(lockDir, '.cognistore-abi-rebuild.lock')); } catch {}
  assert.equal(await recoverAbi(error, { ...deps, env: { ...deps.env, COGNISTORE_ABI_REBUILT: 'true' } }), 23);
  calls.length = 0;
  assert.equal(await recoverAbi(error, { ...deps, env: { ...deps.env, COGNISTORE_ABI_REBUILT: '1' } }), 78);
  assert.deepEqual(calls, []);
  assert.ok(stderr.join('').includes('npx clear-npx-cache'));
  rmSync(lockDir, { recursive: true, force: true });
});

test('failed, timed-out, and failed-respawn adapters terminate recovery', async () => {
  for (const failure of ['exit 1', 'timeout', 'spawn ENOENT']) {
    let respawned = false;
    const diagnostics = [];
    const code = await recoverAbi(error, { rebuildPrefix: '/private/mcp', execPath: '/runtime/node', execArgv: [], argv: ['/runtime/node', '/private/mcp/dist/index.js'], env: {}, siblingNpmExists: false,
      rebuild: async () => { throw new Error(failure); }, respawn: async () => { respawned = true; return 0; }, stderr: (text) => diagnostics.push(text) });
    assert.equal(code, 78);
    assert.equal(respawned, false);
    assert.ok(diagnostics.join('').includes('npm rebuild better-sqlite3 --prefix /private/mcp'));
  }
  assert.equal(await recoverAbi(error, { rebuildPrefix: '/private/mcp', execPath: '/runtime/node', execArgv: [], argv: ['/runtime/node', '/private/mcp/dist/index.js'], env: {}, siblingNpmExists: false,
    rebuild: async () => {}, respawn: async () => { throw new Error('spawn ENOENT'); }, stderr: () => {} }), 78);
});
