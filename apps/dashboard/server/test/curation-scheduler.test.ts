import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurationScheduler, type CurationRun, type ScheduleState } from '../curation-scheduler.js';
import { SETTINGS_DEFAULTS } from '../settings.js';

function harness() {
  let time = Date.parse('2026-11-04T12:00:00Z');
  const settings = { ...SETTINGS_DEFAULTS };
  const state: ScheduleState = { leased: false };
  let shared = new Date(time).toISOString();
  let excluded = false, ready = true;
  const runs = new Map<string, CurationRun>();
  const dispatch = vi.fn(async (options: any) => {
    const row = runs.get(options.runId) ?? { id: options.runId, started_at: new Date(time).toISOString(), trigger: options.trigger };
    Object.assign(row, { status: 'completed', updated_at: new Date(time).toISOString() });
    runs.set(row.id, row as CurationRun);
    if (options.trigger === 'automatic') state.lastAutomaticAt = row.started_at;
    state.incomplete = undefined;
  });
  const recordActivity = vi.fn(async (at: string) => { shared = at; });
  const log = vi.fn();
  const deps = {
    settings: () => settings, now: () => time,
    store: { state: () => state, getRun: (id: string) => runs.get(id), activity: () => shared },
    ready: () => ready, excluded: () => excluded, dispatch, recordActivity, log,
  };
  return {
    deps, settings, state, runs, dispatch, recordActivity, log,
    advance(ms: number) { time += ms; },
    mcpActivity() { shared = new Date(time).toISOString(); },
    exclude(value: boolean) { excluded = value; },
    ready(value: boolean) { ready = value; },
  };
}
const minute = 60_000;
afterEach(() => vi.useRealTimers());
describe('curation scheduler', () => {
  it('idle daily scheduling survives restart and resumes incomplete runs', async () => {
    const h = harness();
    let scheduler = createCurationScheduler(h.deps);
    await scheduler.tick();
    h.advance(10 * minute);
    await scheduler.tick();
    await Promise.resolve();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    await scheduler.dispose();
    scheduler = createCurationScheduler(h.deps);
    await scheduler.tick();
    h.advance(10 * minute);
    await scheduler.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const paused: CurationRun = { id: 'paused-run', status: 'paused', started_at: h.state.lastAutomaticAt!, trigger: 'automatic', updated_at: h.state.lastAutomaticAt! };
    h.state.incomplete = paused;
    h.runs.set(paused.id, paused);
    await scheduler.tick();
    expect(h.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ runId: paused.id }), true, expect.any(AbortSignal));
    await scheduler.dispose();
    h.advance(24 * 60 * minute);
    scheduler = createCurationScheduler(h.deps);
    await scheduler.tick();
    h.advance(10 * minute);
    await scheduler.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(3);
    await scheduler.dispose();
  });

  it('manual run bypasses idle but respects off upgrades and leases', async () => {
    const h = harness(), scheduler = createCurationScheduler(h.deps);
    h.settings.curationAutonomy = 'off';
    expect(() => scheduler.manual()).toThrow(/disabled/);
    h.settings.curationAutonomy = 'suggest';
    h.exclude(true);
    expect(() => scheduler.manual()).toThrow(/maintenance/);
    h.exclude(false);
    h.state.leased = true;
    expect(() => scheduler.manual()).toThrow(/leased/);
    h.state.leased = false;
    h.ready(false);
    expect(() => scheduler.manual()).toThrow(/ready/);
    h.ready(true);
    const first = scheduler.manual();
    expect(scheduler.manual()).toEqual(first);
    await Promise.resolve();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls[0][0].trigger).toBe('manual');
    await scheduler.dispose();
  });

  it('MCP and API activity postpone scheduling without synchronous timer IO', async () => {
    const h = harness(), scheduler = createCurationScheduler(h.deps);
    await scheduler.tick();
    h.advance(10 * minute);
    h.mcpActivity();
    await scheduler.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.advance(10 * minute);
    scheduler.noteActivity();
    expect(h.recordActivity).toHaveBeenCalledTimes(1);
    let acknowledge!: () => void;
    h.recordActivity.mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; }));
    const tick = scheduler.tick();
    await Promise.resolve();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.advance(11 * minute);
    scheduler.noteActivity();
    acknowledge();
    await tick;
    expect(h.dispatch).not.toHaveBeenCalled();
    await scheduler.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.advance(10 * minute);
    await scheduler.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    await scheduler.dispose();
  });

  it('scheduler shutdown clears timers and catches dispatch failures', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.dispatch.mockRejectedValue(new Error('worker unavailable'));
    const scheduler = createCurationScheduler(h.deps);
    scheduler.start();
    expect(vi.getTimerCount()).toBe(1);
    scheduler.manual();
    await scheduler.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('worker unavailable'));
    expect(h.state.lastAutomaticAt).toBeUndefined();
    expect(() => scheduler.manual()).toThrow(/ready/);
    const broken = createCurationScheduler({ ...h.deps, recordActivity: async () => { throw new Error('activity unavailable'); } });
    h.advance(20 * minute);
    await broken.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('activity unavailable'));
    await broken.dispose();
  });
});

// HTTP tests live in this named suite so the authorized focused command also
// exercises registration, authentication, validation and bounded response shapes.
import Fastify from 'fastify';
import { registerCurationRoutes } from '../curation-routes.js';
import { registerAuth } from '../auth.js';
import { createModelManager } from '../curation-models.js';

it('curation routes preserve auth and return bounded action summaries', async () => {
  const h = harness(), scheduler = createCurationScheduler(h.deps);
  const app = Fastify();
  const actionId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const action: any = { id: actionId, kind: 'title', status: 'proposed', confidence: 0.9, entry_ids: JSON.stringify(['entry-1']), created_at: '2026-11-04T00:00:00Z', before_snapshot: 'private snapshot' };
  const queries: string[] = [];
  const db = { prepare(sql: string) {
    queries.push(sql);
    return {
      all: () => [action],
      get: (id: string) => sql.includes('knowledge_entries') ? { id, title: 'Entry', content: 'on-demand content' } : id === actionId ? action : undefined,
    };
  } };
  const sdk = {
    applyCurationAction: vi.fn(async () => ({ applied: false })),
    rejectCurationAction: vi.fn(async () => { action.status = 'rejected'; return { rejected: true }; }),
  };
  const transport = { available: async () => true, pull: vi.fn(), remove: vi.fn() };
  const models = createModelManager({ transport, read: async () => ({ ...SETTINGS_DEFAULTS }) });
  registerAuth(app, { port: 3210, token: 'unit-test-session', dev: false });
  registerCurationRoutes(app, {
    sdk, scheduler, store: h.deps.store, db: () => db,
    settings: () => h.settings, models,
    ensureReady: () => null, excluded: () => false,
    sendError(reply, code, error) { return reply.code(code).send({ error }); },
  });
  const headers = { host: 'localhost:3210', 'x-cognistore-token': 'unit-test-session' };
  try {
    expect((await app.inject({ method: 'GET', url: '/api/curation/queue', headers: { host: 'localhost:3210' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/curation/run', headers: { ...headers, origin: 'https://foreign.example' } })).statusCode).toBe(403);
    for (const query of ['limit=0','limit=abc','scope=bad','cursor=malformed','extra=1']) {
      expect((await app.inject({ method: 'GET', url: `/api/curation/queue?${query}`, headers })).statusCode).toBe(400);
    }
    const queue = await app.inject({ method: 'GET', url: '/api/curation/queue?limit=101', headers });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toEqual({ actions: [{ id: actionId, kind: 'title', status: 'proposed', confidence: 0.9, titles: ['Entry'], entryIds: ['entry-1'] }], nextCursor: null });
    expect(queries.join(' ')).not.toMatch(/snapshot|SELECT \*/);
    const detail = await app.inject({ method: 'GET', url: `/api/curation/actions/${actionId}`, headers });
    expect(detail.json().action.entries[0].content).toBe('on-demand content');
    expect((await app.inject({ method: 'POST', url: '/api/curation/run', headers, payload: { runId: 'invalid' } })).statusCode).toBe(400);
    const started = await app.inject({ method: 'POST', url: '/api/curation/run', headers, payload: { runId } });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ runId, status: 'running' });
    expect((await app.inject({ method: 'GET', url: '/api/curation/runs/33333333-3333-4333-8333-333333333333', headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/curation/actions/${actionId}/apply`, headers })).statusCode).toBe(409);
    const rejected = await app.inject({ method: 'POST', url: `/api/curation/actions/${actionId}/reject`, headers });
    expect(rejected.json().action.status).toBe('rejected');
    const prepared = await app.inject({ method: 'POST', url: '/api/curation/model/prepare', headers });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({ model: SETTINGS_DEFAULTS.curationModel, installed: false, recommendedModel: 'qwen2.5:7b-instruct' });
    expect(transport.pull).not.toHaveBeenCalled();
  } finally { await scheduler.dispose(); await app.close(); }
});

it('transactional scheduling exposes queued runs and deduplicates across sidecars', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { sqliteCurationStore } = await import('../curation-scheduler.js');
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE curation_runs (
    id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT, trigger TEXT,
    model TEXT, budget TEXT, stats TEXT, status TEXT, cursor TEXT,
    updated_at TEXT, lease_owner TEXT, lease_expires_at TEXT
  ); CREATE TABLE curation_activity(singleton INTEGER PRIMARY KEY, last_seen_at TEXT);
  INSERT INTO curation_activity VALUES(1,NULL);`);
  const connection = {
    prepare: (sql: string) => database.prepare(sql),
    transaction(fn: () => unknown) { return { immediate() {
      database.exec('BEGIN IMMEDIATE');
      try { const result = fn(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    } }; },
  };
  const h = harness();
  const store = sqliteCurationStore(() => connection);
  let time = Date.parse('2026-11-04T12:00:00Z');
  const dispatch = vi.fn(async () => { throw new Error('worker start failed'); });
  const deps = { ...h.deps, store, now: () => time, dispatch };
  const first = createCurationScheduler(deps), second = createCurationScheduler(deps);
  try {
    const queued = first.manual();
    expect(store.getRun(queued.runId)).toMatchObject({ id: queued.runId, status: 'running' });
    expect(second.manual()).toEqual(queued);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);
    await first.dispose();
    expect(store.getRun(queued.runId)?.status).toBe('running');
    time += 61_000;
    second.manual();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ runId: queued.runId }), true, expect.any(AbortSignal));
  } finally { await first.dispose(); await second.dispose(); database.close(); }
});
