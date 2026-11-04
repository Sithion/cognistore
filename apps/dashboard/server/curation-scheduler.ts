import { randomUUID } from 'node:crypto';
import type { AppSettings } from './settings.js';

export interface CurationRun {
  id: string; status: string; started_at: string; trigger: string;
  updated_at: string; lease_owner?: string | null; lease_expires_at?: string | null;
}
export interface ScheduleState {
  incomplete?: CurationRun; lastAutomaticAt?: string; leased: boolean;
}
export interface SchedulerStore {
  state(now: number): ScheduleState;
  getRun(id: string): CurationRun | undefined;
  activity(): string | null;
  reserve?(options: CurationDispatchOptions, now: number): { runId: string; status: string; dispatch: boolean; resume: boolean };
}
export type CurationDispatchOptions = {
  autonomy: AppSettings['curationAutonomy']; budgetMs: number; maxClusters: number; maxItems: number;
  trashRetentionDays: number; clusterThreshold: number; deprecatedUnreadDays: number;
  model: string; trigger: string; runId: string; installedCurationModels: string[];
};
export class CurationScheduleError extends Error {
  constructor(message: string, public statusCode: number) { super(message); }
}
export function createCurationScheduler(deps: {
  settings(): AppSettings;
  store: SchedulerStore;
  ready(): boolean;
  excluded(): boolean;
  recordActivity(at: string): Promise<unknown>;
  activityReliable?(): boolean;
  dispatch(options: CurationDispatchOptions, resume: boolean, signal: AbortSignal): Promise<unknown>;
  log(message: string): void;
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}) {
  const now = deps.now ?? Date.now;
  let latestActivity = now(), acknowledged = -Infinity;
  let disposed = false, ticking = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: { runId: string; status: string } | undefined;
  let flight: Promise<unknown> | undefined;
  let activityFlight: Promise<void> | undefined;
  const controller = new AbortController();
  const noteActivity = () => { latestActivity = Math.max(latestActivity, now()); };
  const flushActivity = async () => {
    if (activityFlight) return activityFlight;
    if (acknowledged >= latestActivity) return;
    const captured = latestActivity;
    activityFlight = (async () => {
      const shared = deps.store.activity();
      const sharedTime = shared === null ? NaN : Date.parse(shared);
      await deps.recordActivity(new Date(Number.isFinite(sharedTime) ? Math.max(captured, sharedTime) : captured).toISOString());
      acknowledged = captured;
    })();
    try { await activityFlight; } finally { activityFlight = undefined; }
  };
  const schedule = (manual = false, requestedId?: string) => {
    if (disposed || !deps.ready()) throw new CurationScheduleError('Curation is not ready', 503);
    const settings = deps.settings();
    if (settings.curationAutonomy === 'off' || deps.excluded()) throw new CurationScheduleError('Curation is disabled or maintenance is active', 409);
    if (active) return { ...active };
    const time = now();
    const state = deps.store.state(time);
    const requested = requestedId ? deps.store.getRun(requestedId) : undefined;
    if (requested?.status === 'completed') return { runId: requested.id, status: requested.status };
    const run = state.incomplete ?? requested;
    if (state.leased || run?.lease_owner && Date.parse(run.lease_expires_at ?? '') > time) {
      if (run) return { runId: run.id, status: run.status };
      throw new CurationScheduleError('Curation is leased by another worker', 409);
    }
    if (!manual) {
      const shared = deps.store.activity();
      if (acknowledged < latestActivity || deps.activityReliable?.() === false || shared === null || !Number.isFinite(Date.parse(shared))) {
        throw new CurationScheduleError('Reliable shared activity is unavailable', 503);
      }
      const idleSince = Math.max(latestActivity, Date.parse(shared));
      if (time - idleSince < Math.max(10, settings.curationIdleMinutes) * 60_000) return null;
      if (!run && state.lastAutomaticAt && time - Date.parse(state.lastAutomaticAt) < Math.max(24, settings.curationMinIntervalHours) * 3_600_000) return null;
    }
    // Another process may have just queued this row before its worker acquired
    // the lease. Give that worker a minute before attempting recovery.
    if (run?.status === 'running' && time - Date.parse(run.updated_at) < 60_000) return { runId: run.id, status: run.status };
    const runId = run?.id ?? requestedId ?? randomUUID();
    const options: CurationDispatchOptions = {
      runId, trigger: run?.trigger ?? (manual ? 'manual' : 'automatic'), autonomy: settings.curationAutonomy,
      budgetMs: settings.curationBudgetMs, maxClusters: settings.curationMaxClusters,
      maxItems: settings.curationMaxItems, trashRetentionDays: settings.curationTrashRetentionDays,
      clusterThreshold: settings.curationClusterThreshold, deprecatedUnreadDays: settings.curationDeprecatedUnreadDays,
      model: settings.curationModel, installedCurationModels: settings.installedCurationModels,
    };
    // Manual continuations must retain their original daily identity in the DB,
    // but the worker receives manual policy to bypass automatic activity gates.
    if (manual) options.trigger = 'manual';
    const reservation = deps.store.reserve?.(options, time);
    if (reservation && !reservation.dispatch) return { runId: reservation.runId, status: reservation.status };
    active = { runId: reservation?.runId ?? runId, status: 'running' };
    options.runId = active.runId;
    flight = Promise.resolve().then(() => deps.dispatch(options, reservation?.resume ?? Boolean(run), controller.signal))
      .catch(error => { deps.log(`Curation dispatch failed: ${error instanceof Error ? error.message : error}`); })
      .finally(() => { active = undefined; flight = undefined; });
    return { ...active };
  };
  const tick = async () => {
    if (disposed || ticking || !deps.ready() || deps.excluded()) return;
    ticking = true;
    try {
      await flushActivity();
      if (!disposed && deps.settings().curationAutonomy !== 'off') schedule();
    } catch (error) { deps.log(`Curation scheduler: ${error instanceof Error ? error.message : error}`); }
    finally { ticking = false; }
  };
  return {
    noteActivity, flushActivity, tick,
    manual(runId?: string) { return schedule(true, runId)!; },
    start() {
      if (timer || disposed) return;
      timer = (deps.setInterval ?? setInterval)(() => { void tick(); }, 60_000);
      timer.unref?.();
    },
    async dispose() {
      disposed = true;
      if (timer) (deps.clearInterval ?? clearInterval)(timer);
      timer = undefined;
      controller.abort();
      await flight;
      try { await flushActivity(); } catch (error) { deps.log(`Curation shutdown activity flush failed: ${error}`); }
    },
  };
}
export type CurationScheduler = ReturnType<typeof createCurationScheduler>;

/** Read-only queries use the same SDK handle as the existing maintenance routes. */
export function sqliteCurationStore(db: () => { prepare(sql: string): any; transaction?: (fn: any) => any } | undefined): SchedulerStore {
  const get = () => {
    const value = db();
    if (!value) throw new CurationScheduleError('Curation database unavailable', 503);
    return value;
  };
  return {
    reserve(options, time) {
      const connection = get();
      if (!connection.transaction) throw new CurationScheduleError('Transactional scheduling unavailable', 503);
      return connection.transaction(() => {
        const now = new Date(time).toISOString();
        const current = connection.prepare("SELECT id,status,lease_owner,lease_expires_at,updated_at FROM curation_runs WHERE trigger!='lease' AND status IN ('running','paused','failed') ORDER BY started_at,id LIMIT 1").get();
        const leased = connection.prepare('SELECT 1 FROM curation_runs WHERE lease_owner IS NOT NULL AND lease_expires_at > ? LIMIT 1').get(now);
        if (leased || current?.status === 'running' && time - Date.parse(current.updated_at) < 60_000) {
          if (current) return { runId: current.id, status: current.status, dispatch: false, resume: true };
          throw new CurationScheduleError('Curation is leased by another worker', 409);
        }
        const selected = current ?? connection.prepare("SELECT id,status FROM curation_runs WHERE id=? AND trigger!='lease'").get(options.runId);
        if (selected?.status === 'completed') return { runId: selected.id, status: selected.status, dispatch: false, resume: false };
        if (!selected && options.trigger === 'automatic') {
          const last = connection.prepare("SELECT MAX(started_at) AS at FROM curation_runs WHERE trigger='automatic'").get()?.at;
          // The outer settings gate can require a longer interval; this closes
          // the race between two processes passing that gate simultaneously.
          if (last && time - Date.parse(last) < 24 * 3_600_000) throw new CurationScheduleError('An automatic run already started today', 409);
        }
        const id = selected?.id ?? options.runId;
        if (selected) connection.prepare("UPDATE curation_runs SET status='running',updated_at=? WHERE id=?").run(now, id);
        else connection.prepare("INSERT INTO curation_runs(id,started_at,trigger,model,budget,stats,status,cursor,updated_at) VALUES(?,?,?,?,?,'{}','running','{}',?)")
          .run(id, now, options.trigger, options.model, JSON.stringify(options), now);
        return { runId: id, status: 'running', dispatch: true, resume: Boolean(selected) };
      }).immediate();
    },
    getRun(id) { return get().prepare("SELECT id,status,started_at,trigger,updated_at,lease_owner,lease_expires_at FROM curation_runs WHERE id=? AND trigger!='lease'").get(id); },
    activity() {
      const row = get().prepare('SELECT last_seen_at FROM curation_activity WHERE singleton=1').get();
      if (!row) throw new Error('Shared curation activity row is missing');
      return row.last_seen_at;
    },
    state(time) {
      const connection = get();
      return {
        incomplete: connection.prepare("SELECT id,status,started_at,trigger,updated_at,lease_owner,lease_expires_at FROM curation_runs WHERE status IN ('running','paused','failed') AND trigger!='lease' ORDER BY started_at,id LIMIT 1").get(),
        lastAutomaticAt: connection.prepare("SELECT MAX(started_at) AS at FROM curation_runs WHERE trigger='automatic'").get()?.at ?? undefined,
        leased: Boolean(connection.prepare('SELECT 1 FROM curation_runs WHERE lease_owner IS NOT NULL AND lease_expires_at > ? LIMIT 1').get(new Date(time).toISOString())),
      };
    },
  };
}
