import { delimiter, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'node:fs';

type ErrorLike = { code?: unknown; message?: unknown; cause?: unknown };

export function isAbiError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const pending = [error];
  while (pending.length) {
    const current = pending.pop();
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null || seen.has(current)) continue;
    seen.add(current);
    const candidate = current as ErrorLike;
    if (candidate.code === 'ERR_MODULE_VERSION_MISMATCH') return true;
    if (typeof candidate.message === 'string' && /NODE_MODULE_VERSION|was compiled against a different Node\.js version/i.test(candidate.message)) return true;
    pending.push(candidate.cause);
  }
  return false;
}

export function rebuildPrefixFor(betterSqlitePackageJsonPath: string): string {
  let dir = dirname(resolve(betterSqlitePackageJsonPath));
  for (;;) {
    const parts = dir.split(/[\\/]/);
    const index = parts.lastIndexOf('node_modules');
    if (index >= 0) return parts.slice(0, index).join('/') || '/';
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Could not find node_modules ancestor for ${betterSqlitePackageJsonPath}`);
    dir = parent;
  }
}

export function buildAbiErrorMessage(error: unknown, rebuildPrefix: string): string {
  const seen = new Set<unknown>();
  const pending = [error];
  const messages: string[] = [];
  while (pending.length) {
    const current = pending.pop();
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null || seen.has(current)) continue;
    seen.add(current);
    const candidate = current as ErrorLike;
    if (typeof candidate.message === 'string') messages.push(candidate.message);
    pending.push(candidate.cause);
  }
  const details = messages.join('\n');
  const versions = [...details.matchAll(/NODE_MODULE_VERSION\s+(\d+)/g)].map((match) => match[1]);
  const versionText = versions.length >= 2 ? ` (module ABI ${versions[0]}; this Node.js requires ${versions[1]})` : '';
  return `CogniStore MCP: better-sqlite3 was built for a different Node.js version${versionText}.\nClear cached npx packages with: npx clear-npx-cache\nOr rebuild it with: npm rebuild better-sqlite3 --prefix ${rebuildPrefix}\n${details}`;
}

export function acquireRebuildLock(prefix: string, options: { now?: () => number; sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {}): Promise<{ acquired: boolean; release: () => void }> {
  const lockPath = join(prefix, '.cognistore-abi-rebuild.lock');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 120000;
  const started = now();
  const tryLock = async (): Promise<{ acquired: boolean; release: () => void }> => {
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return { acquired: true, release: () => { try { unlinkSync(lockPath); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    try { if (now() - statSync(lockPath).mtimeMs > 180000) unlinkSync(lockPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!existsSync(lockPath)) return tryLock();
    if (now() - started >= timeoutMs) throw new Error('Timed out waiting for ABI rebuild lock');
    await sleep(500);
    return tryLock();
  };
  mkdirSync(prefix, { recursive: true });
  return tryLock();
}

export function buildRebuildCommand({ execPath, env, rebuildPrefix, siblingNpmExists }: {
  execPath: string; env: NodeJS.ProcessEnv; rebuildPrefix: string; siblingNpmExists: boolean;
}) {
  const cleanEnv = { ...env };
  for (const key of Object.keys(cleanEnv)) if (/^npm_config_(target|runtime|disturl|build_from_source)$/i.test(key)) delete cleanEnv[key];
  const binDir = dirname(execPath);
  cleanEnv.PATH = [binDir, env.PATH].filter(Boolean).join(delimiter);
  return { command: siblingNpmExists ? join(binDir, 'npm') : 'npm', args: ['rebuild', 'better-sqlite3'], cwd: rebuildPrefix, env: cleanEnv, timeout: 120000, shell: false };
}

export async function recoverAbi(error: unknown, deps: {
  rebuildPrefix: string; execPath: string; execArgv: string[]; argv: string[]; env: NodeJS.ProcessEnv;
  siblingNpmExists: boolean; rebuild(spec: ReturnType<typeof buildRebuildCommand>): Promise<void>;
  respawn(spec: { command: string; args: string[]; env: NodeJS.ProcessEnv; stdio: 'inherit' }): Promise<number>;
  stderr(text: string): void;
}): Promise<number> {
  if (!isAbiError(error)) throw error;
  const diagnostic = buildAbiErrorMessage(error, deps.rebuildPrefix);
  if (deps.env.COGNISTORE_ABI_REBUILT === '1') {
    deps.stderr(`${diagnostic}\n`);
    return 78;
  }
  deps.stderr(`${diagnostic}\n`);
  try {
    const lock = await acquireRebuildLock(deps.rebuildPrefix);
    if (!lock.acquired) return await deps.respawn({ command: deps.execPath, args: [...deps.execArgv, ...deps.argv.slice(1)], env: { ...deps.env, COGNISTORE_ABI_REBUILT: '1' }, stdio: 'inherit' });
    try { await deps.rebuild(buildRebuildCommand(deps)); }
    finally { lock.release(); }
    return await deps.respawn({ command: deps.execPath, args: [...deps.execArgv, ...deps.argv.slice(1)], env: { ...deps.env, COGNISTORE_ABI_REBUILT: '1' }, stdio: 'inherit' });
  } catch (failure) {
    deps.stderr(`CogniStore MCP: ABI recovery failed: ${failure instanceof Error ? failure.message : String(failure)}\n`);
    return 78;
  }
}

export function resolvedRebuildPrefix(moduleUrl: string): string {
  const require = createRequire(moduleUrl);
  return rebuildPrefixFor(require.resolve('better-sqlite3/package.json'));
}

export function productionPackageDir(entryUrl: string): string {
  let dir = dirname(fileURLToPath(entryUrl));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === '@cognistore/mcp-server') return dir;
    } catch { /* keep walking toward filesystem root */ }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate @cognistore/mcp-server package root');
    dir = parent;
  }
}
