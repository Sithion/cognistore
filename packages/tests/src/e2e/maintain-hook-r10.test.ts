import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Round 10 (3.5): the session-end hooks suggest /cognistore-maintain when the
 * curation queue of the current workspace is long, the agent has not maintained
 * for 24 h and no suggestion was shown in the last 24 h. State files are data:
 * hostile content must never produce a suggestion or a side effect.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS = resolve(__dirname, '../../../../apps/dashboard/templates/hooks');
const HOOK_SCRIPTS = [
  { name: 'claude-code stop', file: join(HOOKS, 'claude-code/stop-reminder.sh') },
  { name: 'copilot session end', file: join(HOOKS, 'copilot/session-end-reminder.sh') },
];

let sandbox: string;
let project: string;
let cogHome: string;
test.beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'cog-maintain-hook-'));
  project = join(sandbox, 'proj');
  cogHome = join(sandbox, 'cog');
  mkdirSync(project, { recursive: true });
  mkdirSync(cogHome, { recursive: true });
});
test.afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); });

const state = (pending: number, scope = 'workspace:proj') =>
  writeFileSync(join(cogHome, 'curation-state.json'), JSON.stringify({ pending, scopes: { [scope]: pending }, updatedAt: new Date().toISOString() }));
const lastAt = (iso: string) => writeFileSync(join(cogHome, 'agent-maintenance.json'), JSON.stringify({ lastAt: iso }));
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function run(file: string) {
  const r = spawnSync('bash', [file], {
    cwd: project,
    input: '{}',
    env: { PATH: process.env.PATH, HOME: sandbox, TMPDIR: sandbox, COGNISTORE_HOME: cogHome },
    encoding: 'utf-8',
    timeout: 10_000,
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

for (const { name, file } of HOOK_SCRIPTS) {
  test.describe(name, () => {
    test('suggests /cognistore-maintain when 6 proposals are pending and nothing was done before', () => {
      state(6);
      expect(run(file)).toContain('/cognistore-maintain');
      expect(existsSync(join(cogHome, 'hooks-state/maintain-suggested'))).toBe(true);
    });

    test('stays quiet at exactly 5 pending', () => {
      state(5);
      expect(run(file)).not.toContain('/cognistore-maintain');
    });

    test('suggests at most once a day (fresh marker silences it, a 25 h old one does not)', () => {
      state(9);
      expect(run(file)).toContain('/cognistore-maintain');
      expect(run(file)).not.toContain('/cognistore-maintain');
      const marker = join(cogHome, 'hooks-state/maintain-suggested');
      const old = new Date(Date.now() - 25 * 3600_000);
      utimesSync(marker, old, old);
      expect(run(file)).toContain('/cognistore-maintain');
    });

    test('stays quiet when the agent maintained 1 h ago, suggests when it was 30 h ago', () => {
      state(8);
      lastAt(hoursAgo(1));
      expect(run(file)).not.toContain('/cognistore-maintain');
      lastAt(hoursAgo(30));
      expect(run(file)).toContain('/cognistore-maintain');
    });

    test('hostile state files produce no suggestion and no side effect, and exit 0', () => {
      const canary = join(sandbox, 'canary');
      writeFileSync(join(cogHome, 'curation-state.json'),
        `{"pending":"$(touch ${canary})","scopes":{"workspace:proj":"$(touch ${canary})"}}`);
      lastAt(`$(touch ${canary})`);
      expect(run(file)).not.toContain('/cognistore-maintain');
      expect(existsSync(canary)).toBe(false);
      writeFileSync(join(cogHome, 'curation-state.json'), '{"scopes":{"workspace:proj":7');
      expect(() => run(file)).not.toThrow();
    });

    test('missing state files never fail the hook', () => {
      expect(run(file)).not.toContain('/cognistore-maintain');
    });
  });
}
