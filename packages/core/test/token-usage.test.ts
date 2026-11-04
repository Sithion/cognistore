import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenUsageRepository } from '../src/repositories/token-usage.repository.js';
import { ClaudeCodeAdapter } from '../src/services/token-usage/adapters/claude-code.js';
import { CopilotCliAdapter } from '../src/services/token-usage/adapters/copilot-cli.js';
import { TokenUsageService } from '../src/services/token-usage/service.js';
import { makeDb } from './helpers.js';

const DATE = '2025-03-02T10:15:00.000Z';
const range = { from: '2025-03-01T00:00:00.000Z', to: '2025-03-04T00:00:00.000Z' };

function claudeLine(id: string, occurredAt = DATE, model = 'claude-sonnet', input = 10) {
  return JSON.stringify({ sessionId: 'claude-session', timestamp: occurredAt, message: {
    id, model, usage: { input_tokens: input, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
  } });
}

function copilotEvents(sessionId = 'copilot-session', cwd = '/work/alpha', timestamp = DATE) {
  return [
    JSON.stringify({ type: 'session.start', data: { sessionId, context: { cwd } } }),
    '{malformed event',
    JSON.stringify({ type: 'session.shutdown', timestamp, data: { modelMetrics: {
      'gpt-4.1': { usage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 5, cacheWriteTokens: 1 } },
      'empty-model': { usage: {} }, ignored: {},
    } } }),
  ].join('\n') + '\n';
}

describe('token usage scanners and adapters', () => {
  let ctx: ReturnType<typeof makeDb> | undefined;
  let fixtureDir: string | undefined;
  afterEach(() => {
    ctx?.cleanup(); ctx = undefined;
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    fixtureDir = undefined;
  });

  it('scans Claude JSONL incrementally, persists offsets, and reads appended lines once', async () => {
    ctx = makeDb();
    fixtureDir = mkdtempSync(join(tmpdir(), 'token-usage-claude-'));
    const projects = join(fixtureDir, 'projects');
    const projectDir = join(projects, '-Users-dev-Projects-alpha');
    mkdirSync(projectDir, { recursive: true });
    const log = join(projectDir, 'session.jsonl');
    writeFileSync(log, `${claudeLine('msg-1')}\n`);
    const service = new TokenUsageService(new TokenUsageRepository(ctx.sqlite), [new ClaudeCodeAdapter({ projectsDir: projects })]);

    expect(await service.scan()).toMatchObject({ inserted: 1, scanned: 1, bySource: { 'claude-code': { inserted: 1, scanned: 1 } } });
    const firstSize = Buffer.byteLength(`${claudeLine('msg-1')}\n`);
    expect(ctx.sqlite.prepare('SELECT last_offset AS offset FROM scan_state WHERE source = ? AND file_path = ?').get('claude-code', log)).toEqual({ offset: firstSize });
    expect((await service.scan()).inserted).toBe(0);
    expect(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM token_usage').get()).toEqual({ n: 1 });

    appendFileSync(log, `${claudeLine('msg-2', '2025-03-03T11:00:00.000Z')}\n`);
    expect(await service.scan()).toMatchObject({ inserted: 1, scanned: 1 });
    expect((await service.scan()).scanned).toBe(0);
    expect(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM token_usage').get()).toEqual({ n: 2 });
  });

  it('skips malformed and incomplete Claude lines but marks a fully read file', async () => {
    ctx = makeDb();
    fixtureDir = mkdtempSync(join(tmpdir(), 'token-usage-malformed-'));
    const projects = join(fixtureDir, 'projects');
    const projectDir = join(projects, '-tmp-project-zeta');
    mkdirSync(projectDir, { recursive: true });
    const log = join(projectDir, 'events.jsonl');
    writeFileSync(log, `not json\n${JSON.stringify({ timestamp: DATE, message: { usage: { input_tokens: 8 } } })}\n${claudeLine('valid')}\n${claudeLine('partial').slice(0, -5)}`);
    const service = new TokenUsageService(new TokenUsageRepository(ctx.sqlite), [new ClaudeCodeAdapter({ projectsDir: projects })]);

    expect(await service.scan()).toMatchObject({ inserted: 2, scanned: 2 });
    expect(ctx.sqlite.prepare('SELECT message_id AS id, project FROM token_usage ORDER BY id').all()).toEqual([
      { id: null, project: 'zeta' }, { id: 'valid', project: 'zeta' },
    ]);
    expect(ctx.sqlite.prepare('SELECT last_offset AS offset FROM scan_state WHERE file_path = ?').get(log)).toEqual({ offset: Buffer.byteLength(`not json\n${JSON.stringify({ timestamp: DATE, message: { usage: { input_tokens: 8 } } })}\n${claudeLine('valid')}\n${claudeLine('partial').slice(0, -5)}`) });
  });

  it('handles a truncated or rotated Claude file from offset zero and deduplicates repeated message ids', async () => {
    ctx = makeDb();
    fixtureDir = mkdtempSync(join(tmpdir(), 'token-usage-rotate-'));
    const projects = join(fixtureDir, 'projects');
    const projectDir = join(projects, '-tmp-project-rotate');
    mkdirSync(projectDir, { recursive: true });
    const log = join(projectDir, 'events.jsonl');
    writeFileSync(log, `${claudeLine('same-id')}\n`);
    const service = new TokenUsageService(new TokenUsageRepository(ctx.sqlite), [new ClaudeCodeAdapter({ projectsDir: projects })]);
    await service.scan();
    // Known limitation (pending in the plan): same-size file replacement is skipped because Claude resume checks only the stored byte offset.
    writeFileSync(log, `${claudeLine('same-id', '2025-03-03T00:00:00.000Z')}\n`);
    expect(await service.scan()).toMatchObject({ inserted: 0, scanned: 0 });
    writeFileSync(log, `${claudeLine('same-id')}\n`);
    expect(await service.scan()).toMatchObject({ inserted: 0, scanned: 0 });
    expect(ctx.sqlite.prepare('SELECT occurred_at AS at FROM token_usage ORDER BY at').all()).toEqual([
      { at: DATE },
    ]);
  });

  it('parses Copilot session events into per-model records and filters legacy and active sessions', async () => {
    ctx = makeDb();
    fixtureDir = mkdtempSync(join(tmpdir(), 'token-usage-copilot-'));
    const root = join(fixtureDir, 'sessions');
    const done = join(root, 'done');
    const active = join(root, 'active');
    mkdirSync(done, { recursive: true }); mkdirSync(active, { recursive: true });
    writeFileSync(join(done, 'events.jsonl'), copilotEvents());
    writeFileSync(join(active, 'events.jsonl'), `${JSON.stringify({ type: 'session.start', data: { sessionId: 'active' } })}\n`);
    writeFileSync(join(root, 'old-format.jsonl'), copilotEvents());
    const adapter = new CopilotCliAdapter({ sessionStateDir: root });
    const service = new TokenUsageService(new TokenUsageRepository(ctx.sqlite), [adapter]);

    expect(await service.scan()).toMatchObject({ inserted: 2, scanned: 2 });
    expect(ctx.sqlite.prepare('SELECT model, project, session_id AS session, input_tokens AS input, cache_creation_tokens AS cacheWrite FROM token_usage ORDER BY model').all()).toEqual([
      { model: 'empty-model', project: 'alpha', session: 'copilot-session', input: 0, cacheWrite: 0 },
      { model: 'gpt-4.1', project: 'alpha', session: 'copilot-session', input: 20, cacheWrite: 1 },
    ]);
    expect((await service.scan()).inserted).toBe(0);
    expect(ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM scan_state').get()).toEqual({ n: 2 });
  });

  it('reprocesses a changed Copilot events file and uses latest start and shutdown events', async () => {
    ctx = makeDb();
    fixtureDir = mkdtempSync(join(tmpdir(), 'token-usage-copilot-change-'));
    const root = join(fixtureDir, 'sessions');
    const session = join(root, 'session');
    mkdirSync(session, { recursive: true });
    const log = join(session, 'events.jsonl');
    writeFileSync(log, copilotEvents('first', '/old/project'));
    const service = new TokenUsageService(new TokenUsageRepository(ctx.sqlite), [new CopilotCliAdapter({ sessionStateDir: root })]);
    expect((await service.scan()).inserted).toBe(2);
    appendFileSync(log, `${copilotEvents('second', '/new/project', '2025-03-03T00:00:00.000Z')}`);
    expect((await service.scan()).inserted).toBe(2);
    expect(ctx.sqlite.prepare('SELECT DISTINCT session_id AS id, project FROM token_usage ORDER BY id').all()).toEqual([
      { id: 'first', project: 'project' }, { id: 'second', project: 'project' },
    ]);
  });

  it('does not advance past a Copilot file without shutdown, then parses it when shutdown is appended', async () => {
    ctx = makeDb();
    fixtureDir = mkdtempSync(join(tmpdir(), 'token-usage-copilot-live-'));
    const root = join(fixtureDir, 'sessions'); const session = join(root, 'live');
    mkdirSync(session, { recursive: true });
    const log = join(session, 'events.jsonl');
    writeFileSync(log, `${JSON.stringify({ type: 'session.start', data: { sessionId: 'live', context: { cwd: '/p/live' } } })}\n`);
    const service = new TokenUsageService(new TokenUsageRepository(ctx.sqlite), [new CopilotCliAdapter({ sessionStateDir: root })]);
    expect((await service.scan()).scanned).toBe(0);
    expect(ctx.sqlite.prepare('SELECT last_offset AS offset FROM scan_state WHERE file_path = ?').get(log)).toEqual({ offset: Buffer.byteLength(`${JSON.stringify({ type: 'session.start', data: { sessionId: 'live', context: { cwd: '/p/live' } } })}\n`) });
    appendFileSync(log, `${JSON.stringify({ type: 'session.shutdown', timestamp: DATE, data: { modelMetrics: { model: { usage: { inputTokens: 7 } } } } })}\n`);
    expect(await service.scan()).toMatchObject({ inserted: 1, scanned: 1 });
    expect(ctx.sqlite.prepare('SELECT model, input_tokens AS input FROM token_usage').all()).toEqual([{ model: 'model', input: 7 }]);
  });

  it('aggregates totals, dates, models, projects, hour/day and sessions with optional filters', async () => {
    ctx = makeDb();
    const repo = new TokenUsageRepository(ctx.sqlite);
    const row = (id: string, source: string, model: string, project: string | null, session: string | null, at: string, input: number, output: number, read: number, creation: number) => ({
      id, source, model, project, sessionId: session, messageId: id, occurredAt: at,
      inputTokens: input, outputTokens: output, cacheReadTokens: read, cacheCreationTokens: creation,
    });
    expect(repo.insertMany([])).toBe(0);
    expect(repo.insertMany([
      row('r1', 'claude-code', 'claude-sonnet', 'alpha', 's1', DATE, 10, 4, 3, 2),
      row('r2', 'claude-code', 'claude-sonnet', 'alpha', 's1', '2025-03-02T12:15:00.000Z', 2, 1, 0, 0),
      row('r3', 'copilot-cli', 'gpt-4.1', 'beta', 's2', '2025-03-03T10:15:00.000Z', 20, 6, 5, 1),
      row('r4', 'copilot-cli', 'gpt-4.1', null, null, '2025-03-04T10:15:00.000Z', 99, 0, 0, 0),
    ])).toBe(4);
    expect(repo.insertMany([row('r1', 'claude-code', 'claude-sonnet', 'alpha', 's1', DATE, 10, 4, 3, 2)])).toBe(0);
    const service = new TokenUsageService(repo, []);
    const all = service.getAggregates(range);
    expect(all.totals).toEqual({ inputTokens: 32, outputTokens: 11, cacheReadTokens: 8, cacheCreationTokens: 3 });
    expect(all.byDay).toEqual([
      { date: '2025-03-02', inputTokens: 12, outputTokens: 5, cacheReadTokens: 3, cacheCreationTokens: 2 },
      { date: '2025-03-03', inputTokens: 20, outputTokens: 6, cacheReadTokens: 5, cacheCreationTokens: 1 },
    ]);
    expect(all.byModel.map(({ model, totalTokens }) => ({ model, totalTokens }))).toEqual([
      { model: 'gpt-4.1', totalTokens: 32 }, { model: 'claude-sonnet', totalTokens: 22 },
    ]);
    expect(all.byProject.map(({ project, totalTokens, sources }) => ({ project, totalTokens, sources }))).toEqual([
      { project: 'beta', totalTokens: 32, sources: 'copilot-cli' },
      { project: 'alpha', totalTokens: 22, sources: 'claude-code' },
    ]);
    expect(all.byHourDay).toEqual([
      { dayOfWeek: 0, hour: 10, totalTokens: 19 },
      { dayOfWeek: 0, hour: 12, totalTokens: 3 },
      { dayOfWeek: 1, hour: 10, totalTokens: 32 },
    ]);
    expect(all.topSessions.map(({ sessionId, messageCount, totalTokens }) => ({ sessionId, messageCount, totalTokens }))).toEqual([
      { sessionId: 's2', messageCount: 1, totalTokens: 32 }, { sessionId: 's1', messageCount: 2, totalTokens: 22 },
    ]);
    expect(all.cacheEfficiency).toBe(8 / 43);
    expect(service.getAggregates({ ...range, source: 'claude-code' }).totals.inputTokens).toBe(12);
    expect(service.getAggregates({ ...range, model: 'gpt-4.1' }).totals.inputTokens).toBe(20);
    expect(service.getAggregates({ ...range, project: 'alpha' }).totals.inputTokens).toBe(12);
    expect(service.getAggregates({ from: '2030-01-01', to: '2030-01-02' }).cacheEfficiency).toBe(0);
  });
});
