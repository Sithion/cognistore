import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import {
  createDbClient,
  TokenUsageRepository,
  TokenUsageService,
  ClaudeCodeAdapter,
} from '@cognistore/core';
import { KnowledgeType } from '@cognistore/shared';
import { createControlledContext, destroyTestContext, type TestContext } from '../test-helpers.js';
import { startMockOllama } from '../sidecar-helpers.js';

/**
 * Plan v2.6 quick wins 1A.1–1A.4 and 1A.7 (1A.6 lives in cleanup-settings,
 * 1A.5 in settings-duplicates-on-demand).
 */

const count = (ctx: TestContext, sql: string, ...params: unknown[]) =>
  (ctx.sqlite.prepare(sql).get(...params) as { n: number }).n;

async function seed(ctx: TestContext, title: string) {
  return ctx.service.add({
    title, content: `VEC[1,0,0] ${title}`, tags: [], type: KnowledgeType.PATTERN,
    scope: 'global', source: 'test', skipDedup: true,
  } as any);
}

test.describe('@e2e 1A.1 connection pragmas', () => {
  test('every connection gets the tuned pragmas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cognistore-pragmas-'));
    const { sqlite } = createDbClient(join(dir, 'k.db'));
    try {
      const p = (name: string) => sqlite.pragma(name, { simple: true });
      expect(p('journal_mode')).toBe('wal');
      expect(p('synchronous')).toBe(1); // NORMAL
      expect(p('cache_size')).toBe(-32000);
      expect(p('mmap_size')).toBe(268435456);
      expect(p('temp_store')).toBe(2); // MEMORY
      expect(p('journal_size_limit')).toBe(67108864);
      expect(p('busy_timeout')).toBe(5000);
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('@e2e 1A.2 buffered operation counters', () => {
  let ctx: TestContext;
  test.beforeEach(() => { ctx = createControlledContext(); });
  test.afterEach(() => destroyTestContext(ctx));

  test('the stats views show the same numbers the per-call writes produced', async () => {
    const base = ctx.service.getOperationCounts();
    const rawBefore = count(ctx, 'SELECT COUNT(*) AS n FROM operations_log');

    // 3 writes, then searches whose hit counts are the read counts.
    for (const t of ['Alpha', 'Beta', 'Gamma']) await seed(ctx, t);
    let reads = 0;
    // A search counts its hits, and at least one read even with no hits.
    for (let i = 0; i < 4; i++) reads += Math.max(1, (await ctx.service.search('VEC[1,0,0] query', { threshold: 0 })).length);
    expect(reads).toBeGreaterThan(0);

    // Nothing has hit the database yet: the counters are buffered.
    expect(count(ctx, 'SELECT COUNT(*) AS n FROM operations_log')).toBe(rawBefore);

    // Any read of the stats flushes first, so this process always sees its own ops.
    const after = ctx.service.getOperationCounts();
    expect(after.readsLastHour - base.readsLastHour).toBe(reads);
    expect(after.readsLastDay - base.readsLastDay).toBe(reads);
    expect(after.writesLastHour - base.writesLastHour).toBe(3);
    expect(after.writesLastDay - base.writesLastDay).toBe(3);

    // Same raw rows as before (one per operation) and the rollup agrees with them.
    expect(count(ctx, 'SELECT COUNT(*) AS n FROM operations_log') - rawBefore).toBe(reads + 3);
    const today = new Date().toISOString().slice(0, 10);
    const daily = ctx.service.getOperationsByDay(1).find((d) => d.date === today)!;
    expect(daily.reads).toBe(count(ctx, `SELECT COUNT(*) AS n FROM operations_log WHERE operation = 'read' AND date(created_at) = ?`, today));
    expect(daily.writes).toBe(count(ctx, `SELECT COUNT(*) AS n FROM operations_log WHERE operation = 'write' AND date(created_at) = ?`, today));
    // reconcileOperationsDaily (MAX-merge from the raw log) finds nothing to fix.
    ctx.service.reconcileOperationsDaily();
    expect(ctx.service.getOperationsByDay(1).find((d) => d.date === today)).toEqual(daily);
  });

  test('a busy database keeps the operation counts for the next flush, without the 5 s wait', async () => {
    await seed(ctx, 'Held');
    const before = count(ctx, 'SELECT COUNT(*) AS n FROM operations_log');
    const other = new BetterSqlite3(ctx.dbPath);
    other.exec('BEGIN IMMEDIATE'); // holds the write lock, like an agent's write
    try {
      const start = performance.now();
      ctx.service.flushOperations();
      expect(performance.now() - start).toBeLessThan(2000); // 250 ms lock wait
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    expect(ctx.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(count(ctx, 'SELECT COUNT(*) AS n FROM operations_log')).toBe(before); // not written…
    await seed(ctx, 'Later'); // …and not lost: merged with what came after
    ctx.service.flushOperations();
    expect(count(ctx, 'SELECT COUNT(*) AS n FROM operations_log')).toBe(before + 2);
  });

  test('flushPendingWrites writes the buffer in one go', async () => {
    await seed(ctx, 'One');
    const before = count(ctx, 'SELECT COUNT(*) AS n FROM operations_log');
    ctx.service.flushPendingWrites();
    expect(count(ctx, 'SELECT COUNT(*) AS n FROM operations_log')).toBe(before + 1);
    ctx.service.flushPendingWrites(); // idempotent
    expect(count(ctx, 'SELECT COUNT(*) AS n FROM operations_log')).toBe(before + 1);
  });
});

test.describe('@e2e 1A.3 buffered read marks', () => {
  let ctx: TestContext;
  test.beforeEach(() => { ctx = createControlledContext(); });
  test.afterEach(() => destroyTestContext(ctx));

  test('two reads in one window add 2 to read_count in one flush', async () => {
    const e = await seed(ctx, 'Twice');
    await ctx.service.search('VEC[1,0,0] Twice', { trackRead: true, threshold: 0 });
    await ctx.service.search('VEC[1,0,0] Twice', { trackRead: true, threshold: 0 });
    const row = () => ctx.sqlite.prepare('SELECT read_count AS c, last_read_at AS at FROM knowledge_entries WHERE id = ?').get(e.id) as { c: number; at: string | null };
    expect(row().c).toBe(0); // still buffered
    ctx.service.flushPendingWrites();
    expect(row().c).toBe(2);
    expect(row().at).not.toBeNull();
  });

  test('a busy database drops the batch quickly and restores busy_timeout', async () => {
    const e = await seed(ctx, 'Busy');
    ctx.service.flushPendingWrites();
    await ctx.service.search('VEC[1,0,0] Busy', { trackRead: true, threshold: 0 });
    const other = new BetterSqlite3(ctx.dbPath);
    other.exec('BEGIN IMMEDIATE'); // holds the write lock, like an agent's write
    try {
      const start = performance.now();
      ctx.service.flushReads();
      const ms = performance.now() - start;
      expect(ms).toBeLessThan(2000); // 250 ms lock wait, never the 5 s default
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    expect(ctx.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    const c = (ctx.sqlite.prepare('SELECT read_count AS c FROM knowledge_entries WHERE id = ?').get(e.id) as { c: number }).c;
    expect(c).toBe(0); // dropped, best-effort
    ctx.service.flushReads(); // nothing left to write
    expect((ctx.sqlite.prepare('SELECT read_count AS c FROM knowledge_entries WHERE id = ?').get(e.id) as { c: number }).c).toBe(0);
  });
});

test.describe('@e2e 1A.4 token scan state', () => {
  test('a session file without usage lines is recorded, so it is not re-read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cognistore-scan1a-'));
    const { sqlite } = createDbClient(join(dir, 'k.db'));
    try {
      const projectDir = join(dir, 'projects', '-home-u-proj');
      mkdirSync(projectDir, { recursive: true });
      const noUsage = join(projectDir, 'chat.jsonl');
      writeFileSync(noUsage, `${JSON.stringify({ type: 'user', message: { content: 'hi' } })}\n`);
      const withUsage = join(projectDir, 'work.jsonl');
      writeFileSync(withUsage, `${JSON.stringify({
        timestamp: '2026-10-01T00:00:00.000Z', sessionId: 's', message: { id: 'm1', model: 'x', usage: { input_tokens: 3, output_tokens: 4 } },
      })}\n`);
      const service = new TokenUsageService(new TokenUsageRepository(sqlite), [new ClaudeCodeAdapter({ projectsDir: join(dir, 'projects') })]);
      const first = await service.scan();
      expect(first.inserted).toBe(1);
      const states = sqlite.prepare('SELECT file_path AS f, last_offset AS o FROM scan_state').all() as { f: string; o: number }[];
      const byFile = new Map(states.map((s) => [s.f, s.o]));
      expect(byFile.get(resolve(noUsage))).toBe(statSync(noUsage).size);
      expect(byFile.get(resolve(withUsage))).toBe(statSync(withUsage).size);
      const again = await service.scan();
      expect(again.scanned).toBe(0); // both files skipped by size before opening
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = resolve(__dirname, '../../../../apps/mcp-server/dist/index.js');

test.describe('@e2e 1A.7 MCP server perf lines', () => {
  test('COGNISTORE_PERF=1 writes [perf] lines to stderr and the log file, never stdout', async () => {
    test.skip(!existsSync(MCP_ENTRY), `built MCP server missing at ${MCP_ENTRY} — run \`pnpm build\` first`);
    const dir = mkdtempSync(join(tmpdir(), 'cognistore-mcp-perf-'));
    const mock = await startMockOllama('nomic-embed-text');
    const logFile = join(dir, 'perf.log');
    const child = spawn(process.execPath, [MCP_ENTRY], {
      env: {
        ...process.env,
        SQLITE_PATH: join(dir, 'k.db'),
        COGNISTORE_HOME: join(dir, 'home'),
        OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
        OLLAMA_MODEL: 'nomic-embed-text',
        COGNISTORE_PERF: '1',
        COGNISTORE_PERF_INTERVAL_MS: '200',
        COGNISTORE_PERF_LOG: logFile,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    try {
      const deadline = Date.now() + 20_000;
      while (!/\[perf\] eventloop/.test(stderr) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      expect(stderr).toMatch(/\[mcp pid=\d+\] \[perf\] eventloop p50=/);
      expect(stderr).toMatch(/db ops=\d+/); // the SDK's handle is attached
      expect(stdout).not.toContain('[perf]');
      await new Promise((r) => setTimeout(r, 100)); // async append
      expect(readFileSync(logFile, 'utf8')).toMatch(/\[perf\] eventloop/);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      await new Promise<void>((r) => mock.server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('without COGNISTORE_PERF the server stays silent', async () => {
    test.skip(!existsSync(MCP_ENTRY), 'built MCP server missing');
    const dir = mkdtempSync(join(tmpdir(), 'cognistore-mcp-noperf-'));
    const mock = await startMockOllama('nomic-embed-text');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SQLITE_PATH: join(dir, 'k.db'),
      COGNISTORE_HOME: join(dir, 'home'),
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: 'nomic-embed-text',
      COGNISTORE_PERF_INTERVAL_MS: '200',
    };
    delete env.COGNISTORE_PERF;
    const child = spawn(process.execPath, [MCP_ENTRY], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    try {
      await new Promise((r) => setTimeout(r, 1500));
      expect(out).not.toContain('[perf]');
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      await new Promise<void>((r) => mock.server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
