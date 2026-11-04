import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Tables whose row counts are cheap (index-only) and meaningful for the health tab. */
const COUNTED_TABLES = [
  'knowledge_entries', 'token_usage', 'curation_actions', 'curation_runs',
  'curation_verdicts', 'plans', 'plan_tasks',
] as const;

export interface DbHealth {
  sizeBytes: number;
  tables: { name: string; rows: number }[];
  /** token_usage rows / (token_usage + knowledge_entries rows), 0..1. */
  telemetryShare: number;
  /** The sidecar does not record vacuums yet, so this stays null until it does. */
  lastVacuumAt: string | null;
  eventLoopLagMs: { p50: number; p99: number; max: number };
}

type Sqlite = { prepare(sql: string): { get(...args: unknown[]): any } };

export function createEventLoopSampler() {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const ms = (ns: number) => Math.round(ns / 1e4) / 100;
  return {
    /** Percentiles for the window since the previous call, then the window restarts. */
    snapshot() {
      const out = histogram.count > 0
        ? { p50: ms(histogram.percentile(50)), p99: ms(histogram.percentile(99)), max: ms(histogram.max) }
        : { p50: 0, p99: 0, max: 0 };
      histogram.reset();
      return out;
    },
    stop() { histogram.disable(); },
  };
}

export function collectDbHealth(sqlite: Sqlite, eventLoop: () => DbHealth['eventLoopLagMs']): DbHealth {
  const pragma = (name: string) => Number(Object.values(sqlite.prepare(`PRAGMA ${name}`).get() ?? {})[0] ?? 0);
  const sizeBytes = pragma('page_count') * pragma('page_size');
  const tables: DbHealth['tables'] = [];
  for (const name of COUNTED_TABLES) {
    // Table names come from the constant above, never from input.
    try { tables.push({ name, rows: Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get()?.n ?? 0) }); }
    catch { /* table absent on an older schema */ }
  }
  const rows = (name: string) => tables.find(t => t.name === name)?.rows ?? 0;
  const total = rows('token_usage') + rows('knowledge_entries');
  return {
    sizeBytes, tables,
    telemetryShare: total === 0 ? 0 : Math.round((rows('token_usage') / total) * 1000) / 1000,
    lastVacuumAt: null,
    eventLoopLagMs: eventLoop(),
  };
}
