import { test, expect } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { authFetch, getFreePort, spawnSidecar, waitForSidecar, stopSidecar, startMockOllama } from '../sidecar-helpers.js';

test.describe.configure({ mode: 'serial' });

test('full upgrade reports an already incremental database without rewriting it', async () => {
  test.setTimeout(180000);
  const home = mkdtempSync(join(tmpdir(), 'r5-vacuum-already-'));
  const install = join(home, '.cognistore'); mkdirSync(install);
  writeFileSync(join(install, '.version'), '0.0.1');
  const db = join(home, 'db');
  const raw = new BetterSqlite3(db);
  raw.pragma('auto_vacuum = INCREMENTAL'); raw.exec('VACUUM');
  raw.exec('CREATE TABLE preserved(n INTEGER); INSERT INTO preserved VALUES(9)'); raw.close();
  const mock = await startMockOllama('nomic-embed-text');
  let child: ReturnType<typeof spawnSidecar>['child'] | undefined;
  try {
    const port = await getFreePort(); const base = `http://127.0.0.1:${port}`;
    const spawned = spawnSidecar({ HOME: home, COGNISTORE_HOME: install, SQLITE_PATH: db, DASHBOARD_PORT: String(port), SIDECAR_TOKEN: 'test-token', OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text' });
    child = spawned.child;
    expect(await waitForSidecar(base), spawned.readLog()).toBe(true);
    const response = await authFetch(`${base}/api/upgrade/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skipIncrementalVacuum: false }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual(expect.arrayContaining([expect.objectContaining({ step: 'incremental-vacuum', status: 'success', message: expect.stringContaining('already enabled') })]));
  } finally {
    if (child) await stopSidecar(child);
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});

test('failed current-install opt-in is a warning and does not poison default replay', async () => {
  test.setTimeout(180000);
  const home = mkdtempSync(join(tmpdir(), 'r5-vacuum-lock-'));
  const install = join(home, '.cognistore');
  mkdirSync(install);
  const version = JSON.parse(readFileSync(new URL('../../../../apps/dashboard/package.json', import.meta.url), 'utf8')).version;
  writeFileSync(join(install, '.version'), version);
  const db = join(home, 'db');
  const raw = new BetterSqlite3(db);
  raw.pragma('journal_mode = WAL');
  raw.exec('CREATE TABLE preserved(n INTEGER); INSERT INTO preserved VALUES(7)');
  raw.close();
  const mock = await startMockOllama('nomic-embed-text');
  let child: ReturnType<typeof spawnSidecar>['child'] | undefined;
  let base = '';
  try {
    const port = await getFreePort();
    base = `http://127.0.0.1:${port}`;
    child = spawnSidecar({
      HOME: home, COGNISTORE_HOME: install, SQLITE_PATH: db,
      DASHBOARD_PORT: String(port), SIDECAR_TOKEN: 'test-token',
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text',
    }).child;
    expect(await waitForSidecar(base)).toBe(true);
    // Another process holds the write lock for the whole opt-in, so the worker's VACUUM
    // gives up after its 5 s busy timeout: the optional step must end as a warning.
    const holder = new BetterSqlite3(db);
    holder.exec('BEGIN IMMEDIATE');
    let response: Response;
    try {
      response = await authFetch(`${base}/api/upgrade/run`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skipIncrementalVacuum: false }),
      });
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'incremental-vacuum', status: 'warning' }),
    ]));
    const retry = await authFetch(`${base}/api/upgrade/run`, { method: 'POST' });
    expect(retry.status).toBe(200);
    expect((await retry.json()).noop).toBe(true);
  } finally {
    if (child) await stopSidecar(child);
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});

for (const restart of [false, true]) {
  test(`default skip then explicit current-install opt-in; restart=${restart}`, async () => {
    test.setTimeout(180000);
    const home = mkdtempSync(join(tmpdir(), 'r5-vacuum-'));
    const install = join(home, '.cognistore');
    mkdirSync(install);
    const version = JSON.parse(readFileSync(new URL('../../../../apps/dashboard/package.json', import.meta.url), 'utf8')).version;
    writeFileSync(join(install, '.version'), version);
    const db = join(home, 'db');
    const raw = new BetterSqlite3(db);
    raw.pragma('journal_mode = WAL');
    raw.exec('CREATE TABLE preserved(n INTEGER); INSERT INTO preserved VALUES(7)');
    raw.close();
    const mock = await startMockOllama('nomic-embed-text');
    let child: ReturnType<typeof spawnSidecar>['child'] | undefined;
    let base = '';
    async function boot() {
      const port = await getFreePort();
      base = `http://127.0.0.1:${port}`;
      const spawned = spawnSidecar({
        HOME: home, COGNISTORE_HOME: install, SQLITE_PATH: db,
        DASHBOARD_PORT: String(port), SIDECAR_TOKEN: 'test-token',
        OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text',
      });
      child = spawned.child;
      expect(await waitForSidecar(base), spawned.readLog()).toBe(true);
    }
    const post = (body?: unknown) => authFetch(`${base}/api/upgrade/run`, {
      method: 'POST',
      // No content-type without a body: Fastify rejects an empty JSON body with 400,
      // and the dashboard client posts the plain run with no body at all.
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    function mode() {
      const conn = new BetterSqlite3(db);
      try { return conn.pragma('auto_vacuum', { simple: true }); }
      finally { conn.close(); }
    }
    try {
      await boot();
      expect((await post({ skipIncrementalVacuum: 'false' })).status).toBe(400);
      expect((await post()).status).toBe(200);
      expect(mode()).toBe(0);
      if (restart) { await stopSidecar(child!); child = undefined; await boot(); }
      const response = await post({ skipIncrementalVacuum: false });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.noop).not.toBe(true);
      expect(body.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ step: 'incremental-vacuum', status: 'success' }),
      ]));
      expect(mode()).toBe(2);
      const again = await post({ skipIncrementalVacuum: false });
      expect(again.status).toBe(200);
      const conn = new BetterSqlite3(db);
      try {
        expect(conn.prepare('SELECT n FROM preserved').all()).toEqual([{ n: 7 }]);
        expect(conn.pragma('integrity_check', { simple: true })).toBe('ok');
      } finally { conn.close(); }
      const progress = await (await authFetch(`${base}/api/upgrade/progress`)).json();
      for (const step of progress.steps) expect(step).not.toHaveProperty('message');
    } finally {
      if (child) await stopSidecar(child);
      await new Promise<void>((resolve) => mock.server.close(() => resolve()));
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test('dedicated vacuum worker reports a nonzero thread and preserves data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r5-vacuum-worker-'));
  const databasePath = join(dir, 'db');
  const db = new BetterSqlite3(databasePath);
  db.exec('CREATE TABLE preserved(n INTEGER); INSERT INTO preserved VALUES(11)');
  db.close();
  const worker = new Worker(new URL('../../../../packages/core/dist/jobs/vacuum-worker.js', import.meta.url), {
    workerData: { databasePath, operation: 'enable' },
  });
  const timer = setTimeout(() => void worker.terminate(), 15000);
  try {
    const result = await new Promise<any>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => { if (code !== 0) reject(new Error(`worker exit ${code}`)); });
    });
    expect(result.ok).toBe(true);
    expect(result.threadId).toBeGreaterThan(0);
    const after = new BetterSqlite3(databasePath);
    try {
      expect(after.pragma('auto_vacuum', { simple: true })).toBe(2);
      expect(after.prepare('SELECT n FROM preserved').all()).toEqual([{ n: 11 }]);
      expect(after.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally { after.close(); }
  } finally {
    clearTimeout(timer);
    await worker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});
