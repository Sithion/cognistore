import { test, expect } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { fixture } from '../r5-worker-helpers.js';
import { resolve } from 'node:path';
test('built SDK worker opens SQLite and sqlite-vec on its own thread', async () => {
  const f = await fixture(); const runner = f.runner();
  try { const result = await runner.run<any>('health', {}); expect(result.database).toBe(true); expect(result.sqliteVec).toBe(true); expect(result.threadId).toBeGreaterThan(0); }
  finally { await runner.close(); await f.close(); }
});

test('built MCP worker opens SQLite and sqlite-vec on its own thread', async () => {
  const f = await fixture(); const runner = f.runner(new URL(`file://${resolve(process.cwd(), '../../apps/mcp-server/dist/jobs/worker.js')}`));
  try {
    const result = await runner.run<any>('health', {});
    expect(result.database).toBe(true); expect(result.sqliteVec).toBe(true); expect(result.threadId).toBeGreaterThan(0);
  } finally { await runner.close(); await f.close(); }
});

test('health worker opens a WAL database while another connection holds a read transaction', async () => {
  const f = await fixture(); const runner = f.runner();
  const reader = new BetterSqlite3(f.path);
  try {
    reader.pragma('busy_timeout = 5000');
    reader.pragma('journal_mode = WAL');
    reader.exec('BEGIN');
    reader.prepare('SELECT count(*) FROM knowledge_entries').get();
    const result = await runner.run<any>('health', {});
    expect(result.database).toBe(true);
    expect(result.sqliteVec).toBe(true);
    expect(result.threadId).toBeGreaterThan(0);
  } finally {
    if (reader.inTransaction) reader.exec('ROLLBACK');
    reader.close();
    await runner.close();
    await f.close();
  }
});
