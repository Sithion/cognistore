import { appendFile } from 'node:fs/promises';
import { createPerfMonitor as createCorePerfMonitor, type PerfMonitor } from '@cognistore/core';

export type { PerfMonitor } from '@cognistore/core';

/**
 * Sidecar performance monitor (plan v2.6, item 0.2): the shared core monitor
 * with a log-file sink. The summary is appended with fs/promises, once per
 * interval; individual slow ops only go to console.
 */

export interface PerfMonitorOptions {
  logFile: string;
  intervalMs?: number;
  slowMs?: number;
  /** How many of the slowest ops of an interval are written in detail. */
  topN?: number;
}

export function createPerfMonitor(opts: PerfMonitorOptions): PerfMonitor {
  return createCorePerfMonitor({
    intervalMs: opts.intervalMs,
    slowMs: opts.slowMs,
    topN: opts.topN,
    warn: (line) => console.warn(line),
    write: (lines) => {
      const ts = new Date().toISOString();
      const text = lines.map((l) => `[${ts}] [INFO] ${l}\n`).join('');
      for (const l of lines) console.log(l);
      appendFile(opts.logFile, text).catch(() => { /* logging must never crash the sidecar */ });
    },
  });
}
