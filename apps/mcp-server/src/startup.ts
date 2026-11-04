import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KnowledgeSDK, createPerfMonitor } from '@cognistore/sdk';
import { createServer } from './server.js';
import { isAbiError, productionPackageDir, recoverAbi, resolvedRebuildPrefix } from './abi-recovery.js';

type Sdk = KnowledgeSDK;
type StartupOptions = { openSdk?: () => Promise<Sdk> };

function realOpenSdk(): Promise<Sdk> {
  const sdk = new KnowledgeSDK();
  return sdk.initialize().then(() => sdk);
}

function startPerfMonitor(sdk: Sdk): void {
  if (process.env.COGNISTORE_PERF !== '1') return;
  const logFile = process.env.COGNISTORE_PERF_LOG;
  const tag = `[mcp pid=${process.pid}]`;
  const emit = (lines: string[]) => {
    const ts = new Date().toISOString();
    const text = lines.map((line) => `[${ts}] ${tag} ${line}\n`).join('');
    process.stderr.write(text);
    if (logFile) appendFile(logFile, text).catch(() => {});
  };
  sdk.attachPerfMonitor(createPerfMonitor({ intervalMs: Number(process.env.COGNISTORE_PERF_INTERVAL_MS) || undefined, write: emit, warn: (line) => emit([line]) }));
}

function rebuild(spec: ReturnType<typeof import('./abi-recovery.js').buildRebuildCommand>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, spec.timeout);
    child.stdout?.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('timeout'));
      else if (code === 0) resolve(); else reject(new Error(`npm rebuild exited ${code ?? signal}`));
    });
  });
}

function respawn(spec: { command: string; args: string[]; env: NodeJS.ProcessEnv; stdio: 'inherit' }): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { env: spec.env, stdio: spec.stdio });
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of signals) process.on(signal, forward);
    child.once('error', (error) => { for (const signal of signals) process.off(signal, forward); reject(error); });
    child.once('exit', (code, signal) => {
      for (const signal of signals) process.off(signal, forward);
      resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1));
    });
  });
}

import * as os from 'node:os';

export async function startServer({ openSdk = realOpenSdk }: StartupOptions = {}): Promise<void> {
  let sdk: Sdk;
  try {
    sdk = await openSdk();
  } catch (error) {
    if (isAbiError(error)) {
      productionPackageDir(import.meta.url);
      const rebuildPrefix = resolvedRebuildPrefix(import.meta.url);
      const code = await recoverAbi(error, { rebuildPrefix, execPath: process.execPath, execArgv: process.execArgv, argv: process.argv, env: process.env,
        siblingNpmExists: existsSync(join(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm')),
        rebuild, respawn, stderr: (text) => process.stderr.write(text) });
      process.exitCode = code;
      return;
    }
    console.error('Failed to initialize CogniStore SDK:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }
  startPerfMonitor(sdk);
  process.on('exit', () => sdk.flushPendingWrites());
  const server = createServer(sdk);
  await server.connect(new StdioServerTransport());
  const shutdown = async () => { await sdk.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
