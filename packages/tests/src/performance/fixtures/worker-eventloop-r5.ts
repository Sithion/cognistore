import { expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient, TokenUsageRepository, TokenUsageService, ClaudeCodeAdapter,
  startEventLoopMonitor, invalidateDuplicateScan } from '@cognistore/core';
import { startSdk, forbidMain } from '../../r5-worker-helpers.js';
import { ensureFixture, copyFixture, generateTokenJsonlDir } from './generate-fixture.js';
import { report } from './perf-helpers.js';
import { performance as nodePerformance } from 'node:perf_hooks';

async function probe<T>(fn: () => Promise<T>) {
  let max = 0;
  let p99 = 0;
  let drift = 0;
  const monitor = startEventLoopMonitor({
    intervalMs: 20, resolutionMs: 1,
    onReport: (r) => { max = Math.max(max, r.max); p99 = Math.max(p99, r.p99); },
  });
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    drift = Math.max(drift, now - last - 5);
    last = now;
  }, 5);
  const begin = performance.now();
  try {
    const value = await fn();
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { value, max, p99, drift, ms: performance.now() - begin };
  } finally { clearInterval(timer); monitor.stop(); }
}

export async function exercise(kind: 'duplicates' | 'reembed') {
  const dir = mkdtempSync(join(tmpdir(), `r5-perf-${kind}-`));
  const path = copyFixture(ensureFixture().path, dir);
  const client = createDbClient(path);
  const started = await startSdk(path);
  const projectsDir = join(dir, 'projects');
  generateTokenJsonlDir(projectsDir);
  const tokens = new TokenUsageService(new TokenUsageRepository(client.sqlite), [
    new ClaudeCodeAdapter({ projectsDir }),
  ]);
  const restore = forbidMain(kind === 'duplicates' ? ['findDuplicateGroups'] : ['reembedAll']);
  let progressMessages = 0;
  let elu = 0;
  let lockContentionErrors = 0;
  let writerDone = false;
  let writerCommits = 0;
  try {
    invalidateDuplicateScan(client.sqlite);
    let jobFinished = false;
    let overlappingScans = 0;
    const result = await probe(async () => {
      const startElu = nodePerformance.eventLoopUtilization();
      const writerDb = createDbClient(path).sqlite;
      writerDb.pragma('busy_timeout = 5');
      const writer = kind === 'reembed' ? (async () => {
        const update = writerDb.prepare("UPDATE knowledge_entries SET updated_at = updated_at WHERE id = 'k-00001'");
        while (!jobFinished) {
          try { update.run(); writerCommits++; }
          catch (error) {
            const code = (error as { code?: string }).code ?? '';
            if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) lockContentionErrors++;
            else throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        writerDone = true;
        writerDb.close();
      })() : Promise.resolve();
      const job = (kind === 'duplicates'
        ? started.sdk.findDuplicateGroups({ threshold: 0.9, limit: 500, onProgress: () => { progressMessages++; } })
        : started.sdk.reembedAll({ onProgress: () => { progressMessages++; } })).finally(() => { jobFinished = true; });
      const scan = (async () => {
        do {
          if (!jobFinished) overlappingScans++;
          for (let attempt = 0; ; attempt++) {
            try { await tokens.scan(); break; }
            catch (error) {
              const code = (error as { code?: string }).code ?? '';
              if (!code.startsWith('SQLITE_BUSY') && !code.startsWith('SQLITE_LOCKED')) throw error;
              if (attempt >= 100) break;
              await new Promise((resolve) => setTimeout(resolve, Math.min(20, attempt + 1)));
            }
          }
          await new Promise((resolve) => setImmediate(resolve));
        } while (!jobFinished);
      })();
      if (kind === 'duplicates') {
        const value = await job.finally(() => { elu = nodePerformance.eventLoopUtilization(startElu).utilization; });
        await scan; await writer;
        return value;
      }
      const value = await job.finally(() => { elu = nodePerformance.eventLoopUtilization(startElu).utilization; });
      await scan; await writer;
      return value;
    });
    expect(overlappingScans).toBeGreaterThan(0);
    expect(progressMessages).toBeLessThan(500);
    expect(result.max).toBeLessThanOrEqual(100);
    expect(result.drift).toBeLessThanOrEqual(100);
    report(`${kind}.worker`, result.ms, {
      parentP99: result.p99, parentMax: result.max, driftMax: result.drift, overlappingScans, progressMessages, mainThreadElu: elu, concurrentWriterBusyErrors: lockContentionErrors,
    });
    if (kind === 'duplicates') expect((result.value as any[]).length).toBeGreaterThan(50);
    else {
      expect(result.value).toBeGreaterThanOrEqual(10000);
      expect(writerCommits).toBeGreaterThan(0);
      expect(writerDone).toBe(true);
    }
  } finally {
    restore();
    await started.close();
    client.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

