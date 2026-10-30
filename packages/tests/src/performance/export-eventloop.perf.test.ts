import { test, expect } from '@playwright/test';
import { KnowledgeType } from '@cognistore/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbClient, KnowledgeRepository, startEventLoopMonitor, type SQLiteDatabase } from '@cognistore/core';
import { authFetch, getFreePort, spawnSidecar, waitForSidecar, stopSidecar, startMockOllama, TEST_TOKEN } from '../sidecar-helpers.js';
import { report } from './fixtures/perf-helpers.js';

const EVENT_LOOP_LIMIT_MS = 50;
test.describe.configure({ mode: 'serial' });
let home: string; let sqlite: SQLiteDatabase; let child: ReturnType<typeof spawnSidecar>['child'];
let mock: Awaited<ReturnType<typeof startMockOllama>>; let base: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  home = mkdtempSync(join(tmpdir(), 'cognistore-perf-export-'));
  const dbPath = join(home, 'db');
  const client = createDbClient(dbPath); sqlite = client.sqlite;
  const repo = new KnowledgeRepository(client.db, sqlite);
  for (let i = 0; i < 10_000; i++) repo.create({ title: `Export ${i}`, content: `Payload ${i}`, tags: [], type: KnowledgeType.PATTERN, scope: 'global', source: 'perf', embedding: new Array(256).fill(0) });
  mock = await startMockOllama('nomic-embed-text');
  const port = await getFreePort(); base = `http://127.0.0.1:${port}`;
  const spawned = spawnSidecar({ HOME: home, COGNISTORE_HOME: join(home, '.cognistore'), SQLITE_PATH: dbPath, DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN, OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text' });
  child = spawned.child;
  expect(await waitForSidecar(base), spawned.readLog()).toBe(true);
});

test.afterAll(async () => { try { sqlite?.close(); } catch {} if (child) await stopSidecar(child); if (mock) await new Promise<void>((resolve) => mock.server.close(() => resolve())); if (home) rmSync(home, { recursive: true, force: true }); });

test.describe('@perf export without freezing (1C.11)', () => {
  test('10k export keeps main-thread event-loop max below 50 ms', async () => {
    let monitorMax = 0;
    let p99Max = 0;
    const monitor = startEventLoopMonitor({ intervalMs: 20, resolutionMs: 1, onReport: (r) => { monitorMax = Math.max(monitorMax, r.max); p99Max = Math.max(p99Max, r.p99); } });
    const started = performance.now();
    const response = await authFetch(`${base}/api/export`);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    const duration = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 60));
    monitor.stop();
    report('export.10k', duration);
    report('export.10k.eventLoopMax', monitorMax, { p99: p99Max });
    expect(monitorMax).toBeLessThan(EVENT_LOOP_LIMIT_MS);
  });
});
