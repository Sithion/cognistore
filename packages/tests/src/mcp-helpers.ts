import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The bundled MCP server, as npm ships it. Tests talk to the bundle, never to src/. */
export const MCP_ENTRY = resolve(__dirname, '../../../apps/mcp-server/dist/index.js');

/** How to start an MCP server; `env` and `cwd` are part of the launch (e.g. a sandboxed npx). */
export type McpLaunch = { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv };

/** Launch spec for a local bundle (defaults to this checkout's). */
export const bundleLaunch = (entry = MCP_ENTRY): McpLaunch => ({ command: process.execPath, args: [entry] });

/**
 * A published npm build, run through npx exactly as agents configure it, but
 * sandboxed: its own npm cache and user config, and a cwd outside the repo so
 * the workspace .npmrc does not apply. `warmNpx` installs it once up front.
 */
export function npxLaunch(version: string, sandbox: string): McpLaunch {
  return {
    command: 'npx',
    args: ['--yes', `@cognistore/mcp-server@${version}`],
    cwd: sandbox,
    env: {
      HOME: sandbox, // a session's own HOME (connectMcp env) takes precedence
      // better-sqlite3 may fall back to node-gyp, which caches under ~/.cache.
      XDG_CACHE_HOME: join(sandbox, 'cache'),
      npm_config_devdir: join(sandbox, 'node-gyp'),
      npm_config_cache: join(sandbox, 'npm-cache'),
      npm_config_userconfig: join(sandbox, '.npmrc'),
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
    },
  };
}

/**
 * The npx cache persists at a fixed path, and npx runs what it finds there. So
 * the directory must be ours alone: not a symlink, owned by this uid, and not
 * readable or writable by anyone else. Another account could otherwise create
 * it first and plant a package.
 */
function assertOwnPrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || st.isSymbolicLink() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0) {
    throw new Error(`refusing npx sandbox ${dir}: must be a private (0700) directory owned by the current user`);
  }
}

/** Download the npx package into the sandbox cache (network). Throws when npm cannot fetch it. */
export function warmNpx(version: string, sandbox: string): void {
  const { cwd, env } = npxLaunch(version, sandbox);
  assertOwnPrivateDir(sandbox);
  execFileSync('npm', ['exec', '--yes', `--package=@cognistore/mcp-server@${version}`, '--', 'node', '-e', '0'], {
    // No retries: offline must fail fast into a skip, inside the hook's timeout.
    cwd, env: { ...process.env, ...env, npm_config_fetch_retries: '0', npm_config_fetch_timeout: '30000' }, stdio: 'ignore', timeout: 120_000,
  });
}

/**
 * Versions of the MCP server npx has installed in the sandbox cache. The
 * servers do not report their own version (the handshake says 1.0.0), so this
 * is how a test proves which published build npx actually ran.
 */
export function npxInstalledVersions(sandbox: string): string[] {
  const root = join(sandbox, 'npm-cache', '_npx');
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((hash) => {
    const pkg = join(root, hash, 'node_modules', '@cognistore', 'mcp-server', 'package.json');
    return existsSync(pkg) ? [(JSON.parse(readFileSync(pkg, 'utf-8')) as { version: string }).version] : [];
  });
}

/**
 * Connect an MCP client over stdio. StdioClientTransport does NOT inherit
 * process.env, so the caller's overrides are merged onto it here.
 */
export async function connectMcp(launch: McpLaunch, env: NodeJS.ProcessEnv): Promise<Client> {
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...process.env, ...launch.env, ...env } as Record<string, string>,
    cwd: launch.cwd,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const client = new Client({ name: 'cognistore-tests', version: '0.0.0' });
  await client.connect(transport);
  Object.assign(client, { getMcpStderr: () => stderr });
  return client;
}

/** Call a tool and parse its first text block as JSON (falls back to the raw text). */
export async function callJson(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; body: unknown }> {
  let res: { isError?: boolean; content?: { type: string; text?: string }[] };
  try {
    res = (await client.callTool({ name, arguments: args })) as typeof res;
  } catch (error) {
    const stderr = (client as Client & { getMcpStderr?: () => string }).getMcpStderr?.() ?? '';
    throw new Error(`${name} failed: ${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${stderr}`);
  }
  const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* plain-text response */ }
  return { isError: res.isError === true, body };
}
