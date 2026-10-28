import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createDbClient,
  instrumentDatabase,
  KnowledgeRepository,
  KnowledgeService,
  TokenUsageRepository,
  TokenUsageService,
  ClaudeCodeAdapter,
} from '@cognistore/core';
import { copyFixture, ensureFixture, generateTokenJsonlDir } from './fixtures/generate-fixture.js';
import { hashEmbedder, report } from './fixtures/perf-helpers.js';

// Plan v2.6 item 0.5 — contention harness: 3 agent-session processes hammer the
// shared DB (search with trackRead + occasional adds) while this process plays
// the sidecar (stats, token aggregates, operations reconcile, token scan).
// It asserts the harness ran; busy errors and slow writes are RECORDED, not
// limited — they are the numbers phases 1–3 must bring down.

test.describe.configure({ mode: 'serial' });

const WORKERS = 3;
const DURATION_MS = Number(process.env.PERF_CONTENTION_MS ?? 15_000);
const WORKER_SCRIPT = fileURLToPath(new URL('./fixtures/contention-worker.mjs', import.meta.url));

interface WorkerResult {
  worker: number; iterations: number; searches: number; adds: number; busyThrown: number;
  searchP50: number; searchP99: number;
  ops: number; slowOps: number; slowWrites: number; busyErrors: number; maxMs: number;
}

const children = new Set<ReturnType<typeof spawn>>();

function runWorker(dbPath: string, index: number): Promise<{ code: number | null; result?: WorkerResult; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER_SCRIPT, dbPath, String(DURATION_MS), String(index)], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      children.delete(child);
      const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      resolve({ code, result: line ? JSON.parse(line) : undefined, stderr });
    });
  });
}

let dir: string;

test.afterAll(() => {
  for (const child of children) child.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test.describe('@perf contention harness (0.5)', () => {
  test('3 agent sessions + sidecar on one database', async () => {
    test.setTimeout(DURATION_MS + 240_000);
    const fixture = ensureFixture();
    dir = mkdtempSync(join(tmpdir(), 'cognistore-perf-contention-'));
    const dbPath = copyFixture(fixture.path, dir);
    const projectsDir = join(dir, 'claude-projects');
    generateTokenJsonlDir(projectsDir, { projects: 10, filesPerProject: 20, linesPerFile: 20 });

    // The sidecar side, instrumented exactly like the real one (0.2).
    const { db, sqlite } = createDbClient(dbPath);
    const instr = instrumentDatabase(sqlite, { slowMs: 100 });
    const service = new KnowledgeService(new KnowledgeRepository(db, sqlite), hashEmbedder);
    const tokens = new TokenUsageService(new TokenUsageRepository(sqlite), [new ClaudeCodeAdapter({ projectsDir })]);
    const window = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

    const workers = Array.from({ length: WORKERS }, (_, i) => runWorker(dbPath, i));
    const sidecar = { rounds: 0, statsOk: 0, scanInserted: 0, busyThrown: 0 };
    const end = Date.now() + DURATION_MS;
    let results: Awaited<ReturnType<typeof runWorker>>[] = [];
    let sidecarStats: ReturnType<typeof instr.stats>;
    try {
      while (Date.now() < end) {
        try {
          if ((await service.getStats()).total > 0) sidecar.statsOk++;
          tokens.getAggregates(window);
          service.reconcileOperationsDaily();
          sidecar.scanInserted += (await tokens.scan()).inserted;
          // The 6-hourly maintenance, compressed: prune the raw log and checkpoint the WAL.
          if (sidecar.rounds % 10 === 9) {
            service.cleanupOldOperations();
            sqlite.pragma('wal_checkpoint(PASSIVE)');
          }
        } catch (err) {
          if (String((err as { code?: string }).code).startsWith('SQLITE_BUSY')) sidecar.busyThrown++;
          else throw err;
        }
        sidecar.rounds++;
        await sleep(250);
      }
    } finally {
      results = await Promise.all(workers);
      sidecarStats = instr.stats();
      sqlite.close();
    }

    for (const r of results) {
      expect(r.code, `worker exited non-zero:\n${r.stderr}`).toBe(0);
      expect(r.result, `worker printed no result:\n${r.stderr}`).toBeDefined();
      expect(r.result!.iterations).toBeGreaterThan(0);
      expect(r.result!.searches).toBeGreaterThan(0);
      report(`contention.worker${r.result!.worker}`, r.result!.maxMs, { ...r.result });
    }
    expect(sidecar.rounds).toBeGreaterThan(0);
    expect(sidecar.statsOk).toBeGreaterThan(0);
    expect(sidecar.scanInserted).toBeGreaterThan(0);
    expect(results).toHaveLength(WORKERS);
    report('contention.sidecar', sidecarStats.maxMs, { ...sidecar, ...sidecarStats });
  });
});
