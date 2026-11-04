import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleLaunch, connectMcp } from '../mcp-helpers.js';
import { startMockOllama } from '../sidecar-helpers.js';

const mcpPackage = new URL('../../../../apps/mcp-server/package.json', import.meta.url);
const require = createRequire(mcpPackage);
const cli = require.resolve('tsx/cli');
const launcher = fileURLToPath(new URL('./fixtures/abi-launcher.ts', import.meta.url));

test('synthetic startup failure is bounded and writes stderr only', async () => {
  const home = mkdtempSync(join(tmpdir(), 'r5-abi-'));
  const child = spawn(process.execPath, [cli, launcher], { env: { ...process.env, HOME: home, SQLITE_PATH: join(home, 'db'), COGNISTORE_HOME: join(home, '.cognistore'), COGNISTORE_ABI_REBUILT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (x) => { out += x; });
  child.stderr.on('data', (x) => { err += x; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(code).toBe(78);
    expect(out).toBe('');
    expect(err).toContain('CogniStore MCP: better-sqlite3 was built for a different Node.js version');
    expect(err).toContain('127');
    expect(err).toContain('137');
    expect(err).toContain('npx clear-npx-cache');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(home, { recursive: true, force: true });
  }
});

test('published MCP package ships only dist (test launcher excluded)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'r5-abi-production-'));
  const mock = await startMockOllama('nomic-embed-text');
  const pkg = JSON.parse(readFileSync(mcpPackage, 'utf8'));
  expect(pkg.files).toEqual(['dist']);
  let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
  try {
    client = await connectMcp(bundleLaunch(), { HOME: home, SQLITE_PATH: join(home, 'db'), COGNISTORE_HOME: join(home, '.cognistore'), OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text' });
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  } finally {
    await client?.close();
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});

test('bundle exits non-zero with stderr only when the database cannot be opened (non-ABI failure)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'r5-abi-db-open-'));
  const blocker = join(home, 'blocker');
  writeFileSync(blocker, 'not a directory');
  const launch = bundleLaunch();
  const child = spawn(launch.command, launch.args, {
    env: { ...process.env, HOME: home, SQLITE_PATH: join(blocker, 'db.sqlite'), COGNISTORE_HOME: home, OLLAMA_HOST: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (x) => { out += x; });
  child.stderr.on('data', (x) => { err += x; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).not.toBe('');
    expect(err).not.toContain('better-sqlite3 was built for a different Node.js version');

    const hasRebuildLock = (dir: string): boolean => readdirSync(dir, { withFileTypes: true }).some((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return hasRebuildLock(path);
      return entry.isFile() && entry.name === '.cognistore-abi-rebuild.lock';
    });
    expect(hasRebuildLock(home)).toBe(false);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(home, { recursive: true, force: true });
  }
});
