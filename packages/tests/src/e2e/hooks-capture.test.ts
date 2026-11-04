import { test, expect } from '@playwright/test';
import { ConfigManager } from '@cognistore/config';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Runs the REAL Claude Code hook scripts the way Claude Code does: for each event,
 * every matcher-group whose matcher matches the tool name runs, with the payload
 * on stdin. The scripts run straight from the template dir (the config builder
 * takes the scripts dir as a parameter), with TMPDIR and HOME pointed at a
 * sandbox so the session markers never touch the developer's own.
 *
 * B.1 (plan v2.6): post-add-knowledge-marker.sh was deployed but never registered,
 * so the Stop hook said "no knowledge captured" right after an addKnowledge.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = resolve(__dirname, '../../../../apps/dashboard/templates/hooks/claude-code');

type HookCmd = { type: string; command: string; timeout?: number };
type Group = { matcher?: string; hooks: HookCmd[] };

const config = ConfigManager.buildClaudeHookConfig(HOOKS_DIR) as Record<string, Group[]>;

let sandbox: string;
test.beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), 'cog-hook-run-')); });
test.afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); });

/** Claude Code matchers are regexes over the tool name; no matcher = every call. */
function matches(group: Group, toolName: string | undefined): boolean {
  if (!group.matcher) return true;
  return toolName !== undefined && new RegExp(`^(?:${group.matcher})$`).test(toolName);
}

/** Fire one event; returns the parsed stdout of every hook that ran. */
function fire(event: string, payload: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const group of config[event] ?? []) {
    if (!matches(group, payload.tool_name as string | undefined)) continue;
    for (const h of group.hooks) {
      const r = spawnSync('bash', [h.command], {
        input: JSON.stringify({ hook_event_name: event, ...payload }),
        env: { PATH: process.env.PATH, HOME: sandbox, TMPDIR: sandbox, SQLITE_PATH: join(sandbox, 'none.db') },
        encoding: 'utf-8',
        timeout: 10_000,
      });
      expect(r.status, `${basename(h.command)} exit code\n${r.stderr}`).toBe(0);
      out.push(r.stdout.trim() ? JSON.parse(r.stdout) : {});
    }
  }
  return out;
}

/** An MCP result as Claude Code passes it: the JSON body is an escaped string. */
const mcpResponse = (body: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });
const PLAN_ID = '0b4a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

function workSession(sid: string): void {
  fire('UserPromptSubmit', { session_id: sid, prompt: 'fix the bug' });
  fire('PostToolUse', { session_id: sid, tool_name: 'mcp__cognistore__getKnowledge', tool_input: { query: 'bug' }, tool_response: mcpResponse({ results: [] }) });
  fire('PostToolUse', {
    session_id: sid,
    tool_name: 'mcp__cognistore__createPlan',
    tool_input: { title: 'Fix' },
    tool_response: mcpResponse({ id: PLAN_ID, rootPlanId: PLAN_ID, title: 'Fix' }),
  });
  fire('PostToolUse', { session_id: sid, tool_name: 'Edit', tool_input: { file_path: '/tmp/x.ts' }, tool_response: {} });
}

const blocked = (outputs: Record<string, unknown>[]) => outputs.some((o) => o.decision === 'block');
const messages = (outputs: Record<string, unknown>[]) => outputs.map((o) => String(o.systemMessage ?? '')).join('\n');

test('stop does not block after addKnowledge in a session that did work (B.1)', () => {
  const sid = 'b1-captured-session';
  workSession(sid);
  fire('PostToolUse', {
    session_id: sid,
    tool_name: 'mcp__cognistore__addKnowledge',
    tool_input: { entries: { title: 'Learned', content: 'x', tags: [], type: 'fix', scope: 'global', source: 'test' } },
    tool_response: mcpResponse({ id: '11111111-2222-4333-8444-555555555555' }),
  });

  const stop = fire('Stop', { session_id: sid });
  expect(blocked(stop)).toBe(false);
  expect(messages(stop)).toContain('knowledge captured');
  expect(messages(stop)).not.toContain('no knowledge captured');
});

test('a batch addKnowledge (array of entries) also counts as a capture', () => {
  const sid = 'b1-batch-session';
  workSession(sid);
  fire('PostToolUse', {
    session_id: sid,
    tool_name: 'mcp__cognistore__addKnowledge',
    tool_input: { entries: [{ title: 'a' }, { title: 'b' }] },
    tool_response: mcpResponse([{ id: 'a' }, { id: 'b' }]),
  });
  expect(blocked(fire('Stop', { session_id: sid }))).toBe(false);
});

test('stop still blocks once when work was done and nothing was captured', () => {
  const sid = 'b1-uncaptured-session';
  workSession(sid);
  expect(blocked(fire('Stop', { session_id: sid }))).toBe(true);
  // Blocks at most once: the next stop only reminds.
  const second = fire('Stop', { session_id: sid });
  expect(blocked(second)).toBe(false);
  expect(messages(second)).toContain('no knowledge captured');
});

test('a capture in one session does not satisfy another session', () => {
  workSession('b1-session-a');
  workSession('b1-session-b');
  fire('PostToolUse', { session_id: 'b1-session-a', tool_name: 'mcp__cognistore__addKnowledge', tool_input: {}, tool_response: mcpResponse({ id: 'x' }) });
  expect(blocked(fire('Stop', { session_id: 'b1-session-a' }))).toBe(false);
  expect(blocked(fire('Stop', { session_id: 'b1-session-b' }))).toBe(true);
});

test('every deployed hook script is registered, and every registered command exists', () => {
  // The class of bug behind B.1: two hand-kept lists (the template dir and the
  // config builder) with nothing tying them together.
  const deployed = readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.sh') && f !== '_common.sh').sort();
  const referenced = [
    ...new Set(Object.values(config).flat().flatMap((g) => g.hooks.map((h) => basename(h.command)))),
  ].sort();
  expect(referenced).toEqual(deployed);
  for (const g of Object.values(config).flat()) {
    for (const h of g.hooks) expect(h.command.startsWith(HOOKS_DIR + '/')).toBe(true);
  }
});
