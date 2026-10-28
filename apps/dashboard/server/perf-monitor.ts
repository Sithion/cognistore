import { appendFile } from 'node:fs/promises';
import {
  instrumentDatabase,
  startEventLoopMonitor,
  type DbInstrumentation,
  type EventLoopReport,
  type SlowOpEvent,
  type SQLiteDatabase,
} from '@cognistore/core';

/**
 * Sidecar performance monitor (plan v2.6, item 0.2).
 *
 * - Event-loop delay p50/p99/max every `intervalMs` (default 5 min).
 * - Every DB call on the SDK's handle is timed; calls >= `slowMs` (default
 *   100 ms) and SQLITE_BUSY failures are counted, and the slowest ones of the
 *   interval are kept in memory (bounded) and written with the summary.
 *
 * Nothing here does synchronous file I/O: the summary is appended with
 * fs/promises, once per interval. Individual slow ops only go to console.
 */

export interface PerfMonitorOptions {
  logFile: string;
  intervalMs?: number;
  slowMs?: number;
  /** How many of the slowest ops of an interval are written in detail. */
  topN?: number;
}

export interface PerfMonitor {
  /** Instrument a (re)opened SDK handle. Idempotent per handle. */
  attach(sqlite: SQLiteDatabase): void;
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
    console.warn(`[perf] ${e.kind} ${e.method} ${fmt(e.ms)}ms write=${e.write} sql="${e.sql}"`);
    // Bounded top-N by duration: never grows past topN entries.
    if (slowest.length < topN) {
      slowest.push(e);
    } else {
      let minIdx = 0;
      for (let i = 1; i < slowest.length; i++) if (slowest[i].ms < slowest[minIdx].ms) minIdx = i;
      if (e.ms > slowest[minIdx].ms) slowest[minIdx] = e;
    }
  };

  const writeLines = (lines: string[]) => {
    const ts = new Date().toISOString();
    const text = lines.map((l) => `[${ts}] [INFO] ${l}\n`).join('');
    for (const l of lines) console.log(l);
    appendFile(opts.logFile, text).catch(() => { /* logging must never crash the sidecar */ });
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
      writeLines(lines);
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
