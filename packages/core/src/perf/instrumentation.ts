import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { SQLiteDatabase } from '../db/client.js';

/**
 * Lightweight performance instrumentation for the shared SQLite handle and the
 * Node event loop (plan v2.6, item 0.2). Measurement only — it never changes
 * what a query does, and it never records bound parameter values (they carry
 * user knowledge), only the SQL text, truncated.
 */

export interface SlowOpEvent {
  /** 'slow' = took >= slowMs; 'busy' = failed with SQLITE_BUSY / SQLITE_LOCKED. */
  kind: 'slow' | 'busy';
  method: 'run' | 'get' | 'all' | 'exec';
  ms: number;
  /** true for writes. A slow write on a fast statement usually means a lock wait. */
  write: boolean;
  /** Whitespace-collapsed SQL, at most SQL_PREVIEW_CHARS characters. No parameter values. */
  sql: string;
}

export interface DbOpStats {
  ops: number;
  slowOps: number;
  slowWrites: number;
  busyErrors: number;
  maxMs: number;
}

export interface DbInstrumentation {
  stats(): DbOpStats;
  reset(): void;
  /** Restores the original prepare/exec. Statements prepared while installed keep their wrappers. */
  uninstall(): void;
}

export interface EventLoopReport {
  /** Milliseconds. */
  p50: number;
  p99: number;
  max: number;
  mean: number;
}

const SQL_PREVIEW_CHARS = 160;
const BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_BUSY_TIMEOUT', 'SQLITE_LOCKED']);
const INSTALLED = Symbol.for('cognistore.perf.instrumentation');

function previewSql(sql: string): string {
  const flat = String(sql).replace(/\s+/g, ' ').trim();
  return flat.length > SQL_PREVIEW_CHARS ? `${flat.slice(0, SQL_PREVIEW_CHARS - 1)}…` : flat;
}

function isBusyError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && BUSY_CODES.has(code);
}

/**
 * Wrap `sqlite.prepare` (and every statement's run/get/all) plus `sqlite.exec`
 * so each call is timed. Installing twice on the same handle returns the
 * existing instrumentation instead of double-wrapping.
 */
export function instrumentDatabase(
  sqlite: SQLiteDatabase,
  opts: { slowMs?: number; onEvent?: (e: SlowOpEvent) => void } = {},
): DbInstrumentation {
  const existing = (sqlite as unknown as Record<symbol, DbInstrumentation | undefined>)[INSTALLED];
  if (existing) return existing;

  const slowMs = opts.slowMs ?? 100;
  const onEvent = opts.onEvent;
  const stats: DbOpStats = { ops: 0, slowOps: 0, slowWrites: 0, busyErrors: 0, maxMs: 0 };

  const emit = (e: SlowOpEvent) => {
    if (!onEvent) return;
    try { onEvent(e); } catch { /* a broken listener must never break a query */ }
  };

  const timed = <T>(method: SlowOpEvent['method'], sql: string, write: boolean, call: () => T): T => {
    const start = performance.now();
    let busy = false;
    try {
      return call();
    } catch (err) {
      if (isBusyError(err)) {
        busy = true;
        stats.busyErrors++;
        emit({ kind: 'busy', method, ms: performance.now() - start, write, sql: previewSql(sql) });
      }
      throw err;
    } finally {
      const ms = performance.now() - start;
      stats.ops++;
      if (ms > stats.maxMs) stats.maxMs = ms;
      if (!busy && ms >= slowMs) {
        stats.slowOps++;
        if (write) stats.slowWrites++;
        emit({ kind: 'slow', method, ms, write, sql: previewSql(sql) });
      }
    }
  };

  const originalPrepare = sqlite.prepare;
  const originalExec = sqlite.exec;
  const target = sqlite as unknown as {
    prepare: (sql: string) => any;
    exec: (sql: string) => unknown;
  };

  target.prepare = function instrumentedPrepare(this: unknown, sql: string) {
    const stmt = (originalPrepare as (s: string) => any).call(sqlite, sql);
    const write = stmt.reader === false;
    for (const method of ['run', 'get', 'all'] as const) {
      const original = stmt[method];
      if (typeof original !== 'function') continue;
      stmt[method] = function (this: unknown, ...args: unknown[]) {
        return timed(method, sql, write, () => original.apply(stmt, args));
      };
    }
    return stmt;
  };

  target.exec = function instrumentedExec(this: unknown, sql: string) {
    return timed('exec', sql, true, () => (originalExec as (s: string) => unknown).call(sqlite, sql));
  };

  const instrumentation: DbInstrumentation = {
    stats: () => ({ ...stats }),
    reset: () => {
      stats.ops = 0; stats.slowOps = 0; stats.slowWrites = 0; stats.busyErrors = 0; stats.maxMs = 0;
    },
    uninstall: () => {
      target.prepare = originalPrepare as typeof target.prepare;
      target.exec = originalExec as typeof target.exec;
      delete (sqlite as unknown as Record<symbol, unknown>)[INSTALLED];
    },
  };
  (sqlite as unknown as Record<symbol, DbInstrumentation>)[INSTALLED] = instrumentation;
  return instrumentation;
}

/**
 * Report event-loop delay percentiles every `intervalMs`, then reset the
 * histogram. The timer is unref'd so it never keeps a process alive.
 */
export function startEventLoopMonitor(opts: {
  intervalMs: number;
  onReport: (r: EventLoopReport) => void;
  resolutionMs?: number;
}): { stop(): void } {
  const histogram = monitorEventLoopDelay({ resolution: opts.resolutionMs ?? 20 });
  histogram.enable();
  const toMs = (ns: number) => (Number.isFinite(ns) ? ns / 1e6 : 0);
  const timer = setInterval(() => {
    const report: EventLoopReport = {
      p50: toMs(histogram.percentile(50)),
      p99: toMs(histogram.percentile(99)),
      max: toMs(histogram.max),
      mean: toMs(histogram.mean),
    };
    histogram.reset();
    try { opts.onReport(report); } catch { /* reporting must never crash the process */ }
  }, opts.intervalMs);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      histogram.disable();
    },
  };
}
