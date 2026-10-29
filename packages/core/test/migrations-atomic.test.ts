import BetterSqlite3 from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDb } from './helpers.js';
import { runMigrations } from '../src/db/migrate.js';

let ctx: ReturnType<typeof makeDb> | undefined;
let dir: string | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

it('rolls back marked DDL, data and stamp, then permits a corrected never-applied key', () => {
  ctx = makeDb();
  dir = mkdtempSync(join(tmpdir(), 'r5-migration-'));
  const path = join(dir, '90.0.0.sql');
  writeFileSync(path, '-- cognistore:atomic-script\nCREATE TABLE r5_atomic(n INTEGER); INSERT INTO r5_atomic VALUES(7); INVALID SQL;');
  expect(() => runMigrations(ctx!.sqlite, dir!)).toThrow();
  expect(ctx.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='r5_atomic'").get()).toBeUndefined();
  expect(ctx.sqlite.prepare("SELECT version FROM schema_version WHERE version='90.0.0'").get()).toBeUndefined();
  writeFileSync(path, '-- cognistore:atomic-script\nCREATE TABLE r5_atomic(n INTEGER); INSERT INTO r5_atomic VALUES(7);');
  runMigrations(ctx.sqlite, dir);
  expect(ctx.sqlite.prepare('SELECT n FROM r5_atomic').all()).toEqual([{ n: 7 }]);
  runMigrations(ctx.sqlite, dir);
  expect(ctx.sqlite.prepare('SELECT n FROM r5_atomic').all()).toEqual([{ n: 7 }]);
  expect(ctx.sqlite.prepare("SELECT count(*) AS n FROM schema_version WHERE version='90.0.0'").get()).toEqual({ n: 1 });
});

it('executes trigger bodies whole and preserves historical duplicate-column tolerance', () => {
  ctx = makeDb();
  dir = mkdtempSync(join(tmpdir(), 'r5-trigger-'));
  writeFileSync(join(dir, '90.0.0.sql'), `-- cognistore:atomic-script
CREATE TABLE r5_source(n INTEGER);
CREATE TABLE r5_sink(n INTEGER);
CREATE TRIGGER r5_insert AFTER INSERT ON r5_source BEGIN
  INSERT INTO r5_sink VALUES(NEW.n);
  INSERT INTO r5_sink VALUES(NEW.n + 1);
END;`);
  runMigrations(ctx.sqlite, dir);
  ctx.sqlite.exec('INSERT INTO r5_source VALUES(7)');
  expect(ctx.sqlite.prepare('SELECT n FROM r5_sink ORDER BY n').all()).toEqual([{ n: 7 }, { n: 8 }]);
  writeFileSync(join(dir, '90.0.1.sql'), 'ALTER TABLE r5_source ADD COLUMN n INTEGER; INSERT INTO r5_source VALUES(9);');
  runMigrations(ctx.sqlite, dir);
  expect(ctx.sqlite.prepare('SELECT n FROM r5_source ORDER BY n').all()).toEqual([{ n: 7 }, { n: 9 }]);
});

it('repairs the stamped base and keeps disk/embedded opens idempotent', () => {
  ctx = makeDb();
  ctx.sqlite.exec('DROP TABLE operations_log');
  const disk = new URL('../src/db/migrations', import.meta.url).pathname;
  runMigrations(ctx.sqlite, disk);
  expect(ctx.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='operations_log'").get()).toEqual({ name: 'operations_log' });
  const versions = ctx.sqlite.prepare('SELECT version FROM schema_version ORDER BY version').all();
  runMigrations(ctx.sqlite, join(tmpdir(), 'r5-absent-migrations'));
  expect(ctx.sqlite.prepare('SELECT version FROM schema_version ORDER BY version').all()).toEqual(versions);
  expect(ctx.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
});

it('an up-to-date open takes no write lock', () => {
  ctx = makeDb();
  const a = new BetterSqlite3(ctx.sqlite.name);
  const b = ctx.sqlite;
  try {
    b.pragma('busy_timeout = 100');
    a.exec('BEGIN IMMEDIATE');
    const started = Date.now();
    expect(() => runMigrations(b, new URL('../src/db/migrations', import.meta.url).pathname)).not.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  } finally {
    if (a.inTransaction) a.exec('ROLLBACK');
    a.close();
    b.close();
  }
});

it('detects an atomic script after leading whitespace in embedded-style SQL', () => {
  ctx = makeDb();
  dir = mkdtempSync(join(tmpdir(), 'r5-embedded-atomic-'));
  writeFileSync(join(dir, '90.0.0.sql'), `\n-- cognistore:atomic-script
CREATE TABLE r5_source(n INTEGER);
CREATE TABLE r5_sink(n INTEGER);
CREATE TRIGGER r5_insert AFTER INSERT ON r5_source BEGIN
  INSERT INTO r5_sink VALUES(NEW.n);
  INSERT INTO r5_sink VALUES(NEW.n + 1);
END;`);
  runMigrations(ctx.sqlite, dir);
  ctx.sqlite.exec('INSERT INTO r5_source VALUES(7)');
  expect(ctx.sqlite.prepare('SELECT n FROM r5_sink ORDER BY n').all()).toEqual([{ n: 7 }, { n: 8 }]);
});
