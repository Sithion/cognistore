import {
  instrumentDatabase,
  startEventLoopMonitor,
  type DbInstrumentation,
  type EventLoopReport,
  type SlowOpEvent,
} from './instrumentation.js';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Process performance monitor (plan v2.6, items 0.2 and 1A.7), shared by the
 * sidecar and the MCP server.
 *
 * - Event-loop delay p50/p99/max every `intervalMs` (default 5 min).
 * - Every DB call on the attached handle is timed; calls >= `slowMs` (default
 *   100 ms) and SQLITE_BUSY failures are counted, and the slowest ones of the
 *   interval are kept in memory (bounded) and reported with the summary.
 *
 * Where the `[perf]` lines go is the caller's choice (`write` for the interval
 * summary, `warn` for each slow op as it happens): the sidecar appends to its
 * log file, the MCP server writes to stderr — never stdout, which carries the
 * JSON-RPC stream. Sinks must not do synchronous file I/O.
 */

export interface PerfMonitorOptions {
  /** Receives the summary lines of each interval. */
  write: (lines: string[]) => void;
  /** Receives one line per slow op as it happens. */
  warn?: (line: string) => void;
  intervalMs?: number;
  slowMs?: number;
  /** How many of the slowest ops of an interval are reported in detail. */
  topN?: number;
}

export interface PerfMonitor {
  /** Instrument a (re)opened database handle. Idempotent per handle. */
  attach(sqlite: BetterSqlite3.Database): void;
  stop(): void;
}

const fmt = (n: number) => n.toFixed(1);

export function formatPerfSummary(el: EventLoopReport, db: ReturnType<DbInstrumentation['stats']> | null): string {
  const loop = `eventloop p50=${fmt(el.p50)}ms p99=${fmt(el.p99)}ms max=${fmt(el.max)}ms mean=${fmt(el.mean)}ms`;
  if (!db) return `[perf] ${loop} | db=not-attached`;
  return `[perf] ${loop} | db ops=${db.ops} slow=${db.slowOps} slowWrites=${db.slowWrites} busy=${db.busyErrors} maxOp=${fmt(db.maxMs)}ms`;
}

export function createPerfMonitor(opts: PerfMonitorOptions): PerfMonitor {
  const intervalMs = opts.intervalMs ?? 5 * 60 * 1000;
  const slowMs = opts.slowMs ?? 100;
  const topN = opts.topN ?? 10;

  let instrumentation: DbInstrumentation | null = null;
  let slowest: SlowOpEvent[] = [];

  const record = (e: SlowOpEvent) => {
    try { opts.warn?.(`[perf] ${e.kind} ${e.method} ${fmt(e.ms)}ms write=${e.write} sql="${e.sql}"`); } catch { /* never crash */ }
    // Bounded top-N by duration: never grows past topN entries.
    if (slowest.length < topN) {
      slowest.push(e);
    } else {
      let minIdx = 0;
      for (let i = 1; i < slowest.length; i++) if (slowest[i].ms < slowest[minIdx].ms) minIdx = i;
      if (e.ms > slowest[minIdx].ms) slowest[minIdx] = e;
    }
  };

  const monitor = startEventLoopMonitor({
    intervalMs,
    onReport: (el) => {
      const db = instrumentation?.stats() ?? null;
      const lines = [formatPerfSummary(el, db)];
      for (const e of [...slowest].sort((a, b) => b.ms - a.ms)) {
        lines.push(`[perf]   ${e.kind} ${e.method} ${fmt(e.ms)}ms write=${e.write} sql="${e.sql}"`);
      }
      instrumentation?.reset();
      slowest = [];
      opts.write(lines);
    },
  });

  return {
    attach(sqlite) {
      instrumentation = instrumentDatabase(sqlite, { slowMs, onEvent: record });
    },
    stop() {
      monitor.stop();
    },
  };
}
