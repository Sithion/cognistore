import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDbClient } from '@cognistore/core';

const coreEntry = pathToFileURL(fileURLToPath(
  new URL('../../../core/dist/index.js', import.meta.url),
)).href;
const migrations = fileURLToPath(new URL('../../../core/src/db/migrations', import.meta.url));

test('two READY children open after one barrier, three fresh databases', async () => {
  test.setTimeout(120000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const dir = mkdtempSync(join(tmpdir(), 'r5-concurrency-'));
    const db = join(dir, 'db');
    const barrier = join(dir, 'GO');
    const script = join(dir, 'child.mjs');
    writeFileSync(script, `
import { watch, existsSync } from 'node:fs';
import { createDbClient } from ${JSON.stringify(coreEntry)};
const barrier = ${JSON.stringify(barrier)};
const ready = new Promise((resolve) => {
  const watcher = watch(${JSON.stringify(dir)}, () => {
    if (existsSync(barrier)) { watcher.close(); resolve(); }
  });
  if (existsSync(barrier)) { watcher.close(); resolve(); }
});
console.log('READY');
await ready;
const { sqlite } = createDbClient(${JSON.stringify(db)});
sqlite.close();
console.log('CLOSED');
`);
    const children: ChildProcess[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    try {
      const jobs = [0, 1].map((n) => {
        const home = join(dir, `home-${n}`);
        mkdirSync(home);
        const child = spawn(process.execPath, [script], {
          env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(child);
        let output = '';
        let errors = '';
        let resolveReady!: () => void;
        let rejectReady!: (error: Error) => void;
        const ready = new Promise<void>((resolve, reject) => {
          resolveReady = resolve; rejectReady = reject;
        });
        child.stdout!.on('data', (chunk) => {
          output += chunk;
          if (output.split(/\r?\n/).includes('READY')) resolveReady();
        });
        child.stderr!.on('data', (chunk) => { errors += chunk; });
        const exited = new Promise<number | null>((resolve, reject) => {
          child.once('error', (error) => { rejectReady(error); reject(error); });
          child.once('exit', (code) => {
            if (!output.includes('READY')) rejectReady(new Error(errors || 'exited before READY'));
            resolve(code);
          });
        });
        timers.push(setTimeout(() => {
          rejectReady(new Error('30s readiness/open timeout'));
          child.kill('SIGKILL');
        }, 30000));
        return { ready, exited, output: () => output, errors: () => errors };
      });
      await Promise.all(jobs.map((job) => job.ready));
      expect(jobs.map((job) => job.output().trim())).toEqual(['READY', 'READY']);
      writeFileSync(barrier, 'GO');
      expect(await Promise.all(jobs.map((job) => job.exited))).toEqual([0, 0]);
      for (const job of jobs) expect(job.output()).toContain('CLOSED');
      const { sqlite } = createDbClient(db);
      try {
        const expected = readdirSync(migrations).filter((f) => f.endsWith('.sql'))
          .map((f) => ({ version: f.slice(0, -4), n: 1 }))
          .sort((a, b) => a.version.localeCompare(b.version));
        expect(sqlite.prepare('SELECT version, count(*) AS n FROM schema_version GROUP BY version ORDER BY version').all())
          .toEqual(expected);
        expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
      } finally { sqlite.close(); }
    } finally {
      for (const timer of timers) clearTimeout(timer);
      await Promise.all(children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          child.kill('SIGKILL');
        });
      }));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
