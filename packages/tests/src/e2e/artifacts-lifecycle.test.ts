import { test, expect } from '@playwright/test';
import { type Server } from 'node:http';
import { type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  authFetch, SERVER_ENTRY, TEST_TOKEN, getFreePort, startMockOllama, spawnSidecar, waitForSidecar, stopSidecar,
} from '../sidecar-helpers.js';

/**
 * Setup → setup again → version upgrade → uninstall, through the real sidecar
 * routes, in a sandboxed HOME pre-filled with the user's own agent config
 * (plan v2.6, T.5). Proves for all three platforms that:
 *   - setup injects every artifact the CLAUDE.md symmetry table lists;
 *   - a second setup changes nothing (idempotent);
 *   - an upgrade re-deploy converges on the same tree;
 *   - uninstall brings the home back to exactly what the user had.
 *
 * ⚠️ Uninstall shells out to `ollama rm`. A fake `ollama` first on PATH records
 * the calls, so the developer's real models are never touched.
 */

type Snapshot = Record<string, string>;

/** Files that are allowed to differ between snapshots, and why. */
const VOLATILE = [
  // Rollback copies the injection paths take before editing a user file; kept by
  // uninstall on purpose (they are the user's way back).
  /\.bak\./,
  // Runtime state of the sidecar itself, not an injected artifact.
  /^\.cognistore\/(knowledge\.db.*|cognistore\.log.*|settings\.json|\.version|\.artifacts-version)$/,
];
const isVolatile = (rel: string) => VOLATILE.some((re) => re.test(rel));

/** relpath → content hash; JSON is parsed and re-serialised with sorted keys so key order is not a diff. */
function snapshot(home: string): Snapshot {
  const out: Snapshot = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(home, abs);
      const st = lstatSync(abs);
      if (st.isDirectory()) { walk(abs); continue; }
      if (isVolatile(rel)) continue;
      let body = readFileSync(abs, 'utf-8');
      if (rel.endsWith('.json')) {
        try { body = JSON.stringify(sortKeys(JSON.parse(body))); } catch { /* keep raw */ }
      }
      out[rel] = createHash('sha256').update(body).digest('hex').slice(0, 16) + ((st.mode & 0o111) ? ' +x' : '');
    }
  };
  walk(home);
  return out;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as any)[k])]));
  }
  return v;
}

function diff(a: Snapshot, b: Snapshot): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].sort().filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k] ?? '(absent)'} → ${b[k] ?? '(absent)'}`);
}


/** The user's own config, there before CogniStore was ever installed. */
const USER_HOME: Record<string, string> = {
  '.claude/CLAUDE.md': '# My rules\n\nAlways answer in haiku.\n',
  '.claude/settings.json': JSON.stringify({
    theme: 'dark',
    permissions: { allow: ['Bash(ls:*)'], deny: ['Bash(rm:*)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/local/bin/my-stop.sh' }] }] },
  }, null, 2),
  '.claude.json': JSON.stringify({ numStartups: 3, mcpServers: { other: { command: 'other-mcp' } } }, null, 2),
  '.claude/mcp-config.json': JSON.stringify({ mcpServers: { other: { command: 'other-mcp' } } }, null, 2),
  '.copilot/mcp-config.json': JSON.stringify({ mcpServers: { other: { command: 'other-mcp' } } }, null, 2),
  // Only the schema reference, as opencode writes it by default: the file is the
  // user's, so uninstall must give it back, not delete it.
  '.config/opencode/opencode.json': JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2),
  '.config/opencode/AGENTS.md': '# Team notes\n',
  '.claude/skills/my-skill/SKILL.md': '---\nname: my-skill\n---\nmine\n',
};

test.describe.configure({ timeout: 240_000 });

for (const [scenario, userHome] of [
  ['user config already present', USER_HOME],
  ['fresh machine', {}],
] as const) {
test.describe.serial(`agent artifacts lifecycle — ${scenario} (real sidecar, sandboxed HOME, 3 platforms)`, () => {
  let child: ChildProcess;
  let mock: { server: Server; port: number };
  let baseUrl: string;
  let root: string;
  let home: string;
  let ollamaLog: string;
  let readServerLog: () => string = () => '';
  const snapshots: Record<string, Snapshot> = {};
  const has = (rel: string) => rel in userHome;

  function write(rel: string, body: string) {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), body);
  }
  const readJson = (rel: string) => JSON.parse(readFileSync(join(home, rel), 'utf-8'));
  const read = (rel: string) => readFileSync(join(home, rel), 'utf-8');
  const post = async (path: string, body?: unknown) => {
    const r = await authFetch(`${baseUrl}${path}`, {
      method: 'POST',
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    expect(r.status, `${path}\n${readServerLog().slice(-2000)}`).toBe(200);
    return r.json() as Promise<any>;
  };

  test.beforeAll(async () => {
    test.skip(!existsSync(SERVER_ENTRY), `built sidecar missing at ${SERVER_ENTRY} — run \`pnpm build\` first`);
    root = mkdtempSync(join(tmpdir(), 'cognistore-lifecycle-'));
    home = join(root, 'home');
    if (home === homedir() || homedir().startsWith(root)) throw new Error(`refusing to run: sandbox ${home} is the real home`);
    mkdirSync(home);
    for (const [rel, body] of Object.entries(userHome)) write(rel, body);

    const bin = join(root, 'bin');
    mkdirSync(bin);
    ollamaLog = join(root, 'ollama-calls.log');
    writeFileSync(join(bin, 'ollama'), `#!/bin/sh\necho "$@" >> '${ollamaLog}'\nexit 0\n`);
    chmodSync(join(bin, 'ollama'), 0o755);

    const distDir = join(root, 'dist');
    mkdirSync(distDir);
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>test</title>');

    snapshots.initial = snapshot(home);

    const model = 'nomic-embed-text';
    mock = await startMockOllama(model);
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const spawned = spawnSidecar({
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'),
      COGNISTORE_HOME: join(home, '.cognistore'),
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: model,
      DASHBOARD_PORT: String(port),
      DASHBOARD_DIST_PATH: distDir,
      SIDECAR_TOKEN: TEST_TOKEN,
    });
    child = spawned.child;
    readServerLog = spawned.readLog;
    if (!(await waitForSidecar(baseUrl))) throw new Error(`sidecar never became ready.\n${readServerLog()}`);
  });

  test.afterAll(async () => {
    await stopSidecar(child);
    await new Promise<void>((res) => (mock?.server ? mock.server.close(() => res()) : res()));
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('setup injects every artifact, for all three platforms', async () => {
    const res = await post('/api/setup/configure');
    expect(res.success).toBe(true);
    snapshots.setup1 = snapshot(home);

    // Instructions: markers appended, user text kept.
    for (const rel of ['.claude/CLAUDE.md', '.github/copilot-instructions.md', '.copilot/copilot-instructions.md', '.config/opencode/AGENTS.md']) {
      expect(read(rel), rel).toMatch(/COGNISTORE/i);
    }
    if (has('.claude/CLAUDE.md')) expect(read('.claude/CLAUDE.md')).toContain('Always answer in haiku.');
    if (has('.config/opencode/AGENTS.md')) expect(read('.config/opencode/AGENTS.md')).toContain('# Team notes');

    // MCP entries, user servers kept.
    for (const rel of ['.claude/mcp-config.json', '.claude.json', '.copilot/mcp-config.json']) {
      const cfg = readJson(rel);
      expect(cfg.mcpServers.cognistore, rel).toBeTruthy();
      if (has(rel)) expect(cfg.mcpServers.other, rel).toEqual({ command: 'other-mcp' });
    }
    expect(readJson('.claude.json').mcpServers.cognistore.env.COGNISTORE_PLATFORM).toBe('claude-code');
    expect(readJson('.copilot/mcp-config.json').mcpServers.cognistore.env.COGNISTORE_PLATFORM).toBe('copilot');
    const opencode = readJson('.config/opencode/opencode.json');
    expect(opencode.$schema).toBe('https://opencode.ai/config.json');
    expect(JSON.stringify(opencode)).toContain('cognistore');

    // Claude settings: our allow/deny + hooks next to the user's.
    const settings = readJson('.claude/settings.json');
    if (has('.claude/settings.json')) {
      expect(settings.theme).toBe('dark');
      expect(settings.permissions.allow).toContain('Bash(ls:*)');
      expect(settings.permissions.deny).toContain('Bash(rm:*)');
      expect(JSON.stringify(settings.hooks)).toContain('/usr/local/bin/my-stop.sh');
    }
    expect(settings.permissions.allow.some((r: string) => r.startsWith('mcp__cognistore'))).toBe(true);
    expect(settings.permissions.deny).toEqual(expect.arrayContaining([
      'mcp__cognistore__deleteKnowledge', 'mcp__cognistore__deletePlanTask',
    ]));
    const hookCmds = JSON.stringify(settings.hooks);
    expect(hookCmds).toContain('post-add-knowledge-marker.sh');   // B.1
    expect(JSON.stringify(readJson('.copilot/hooks/hooks.json'))).toContain('post-tool-marker.sh');

    // Hook scripts, executable.
    for (const f of readdirSync(join(home, '.cognistore/hooks/claude-code')).filter((f) => f !== '_common.sh')) {
      expect(lstatSync(join(home, '.cognistore/hooks/claude-code', f)).mode & 0o111, f).not.toBe(0);
    }

    // Skills on every platform; the user's own skill untouched.
    for (const name of ['cognistore-query', 'cognistore-capture', 'cognistore-plan']) {
      expect(existsSync(join(home, '.claude/skills', name, 'SKILL.md')), `claude ${name}`).toBe(true);
      expect(existsSync(join(home, '.copilot/skills', name, 'SKILL.md')), `copilot ${name}`).toBe(true);
      expect(existsSync(join(home, '.config/opencode/skills', name, 'SKILL.md')), `opencode ${name}`).toBe(true);
    }
    if (has('.claude/skills/my-skill/SKILL.md')) {
      expect(read('.claude/skills/my-skill/SKILL.md')).toBe(USER_HOME['.claude/skills/my-skill/SKILL.md']);
    }
  });

  test('a second setup changes nothing', async () => {
    expect((await post('/api/setup/configure')).success).toBe(true);
    snapshots.setup2 = snapshot(home);
    expect(diff(snapshots.setup1, snapshots.setup2)).toEqual([]);
  });

  test('a version upgrade re-deploys onto the same tree', async () => {
    writeFileSync(join(home, '.cognistore', '.version'), '2.5.0');
    const res = await post('/api/upgrade/run');
    expect(res.noop).toBeFalsy();
    snapshots.upgraded = snapshot(home);
    expect(diff(snapshots.setup2, snapshots.upgraded)).toEqual([]);
  });

  test('uninstall restores the home to exactly what the user had', async () => {
    const res = await post('/api/uninstall', { removeOllama: false });
    expect(res.success).toBe(true);
    expect(res.errors ?? []).toEqual([]);
    // The route answers, then exits the process after a 3 s grace period.
    await new Promise<void>((r) => (child.exitCode !== null ? r() : child.once('exit', () => r())));

    snapshots.uninstalled = snapshot(home);
    expect(diff(snapshots.initial, snapshots.uninstalled)).toEqual([]);
    expect(existsSync(join(home, '.cognistore'))).toBe(false);

    // Only the models this app pulled were removed; Ollama itself was left alone.
    const calls = readFileSync(ollamaLog, 'utf-8').trim().split('\n');
    expect(calls.every((c) => c.startsWith('rm '))).toBe(true);
    expect(calls).toContain('rm nomic-embed-text');
  });
});
}
