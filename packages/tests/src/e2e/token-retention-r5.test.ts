import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { authFetch, getFreePort, spawnSidecar, waitForSidecar, stopSidecar, startMockOllama } from '../sidecar-helpers.js';

test('retention settings retain shape and validate every supplied value', async () => {
  const home = mkdtempSync(join(tmpdir(), 'r5-retention-api-'));
  const mock = await startMockOllama('nomic-embed-text');
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const { child, readLog } = spawnSidecar({
    HOME: home, SQLITE_PATH: join(home, '.cognistore', 'knowledge.db'),
    DASHBOARD_PORT: String(port), SIDECAR_TOKEN: 'test-token',
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text',
  });
  try {
    expect(await waitForSidecar(base), readLog()).toBe(true);
    expect((await (await authFetch(`${base}/api/settings`)).json()).tokenUsageRetentionDays).toBe(90);
    for (const [input, expected] of [[0, 0], [36500, 36500], [90, 90],
      [-1, 90], [1.5, 90], [36501, 90], ['7', 90], [null, 90]] as const) {
      const response = await authFetch(`${base}/api/settings`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenUsageRetentionDays: input }),
      });
      expect(response.status).toBe(200);
      expect((await (await authFetch(`${base}/api/settings`)).json()).tokenUsageRetentionDays).toBe(expected);
    }
  } finally {
    await stopSidecar(child);
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});

test('token usage API combines daily rollups and raw range edges with filters', async () => {
  const home = mkdtempSync(join(tmpdir(), 'r5-token-usage-api-'));
  const mock = await startMockOllama('nomic-embed-text');
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const dbPath = join(home, '.cognistore', 'knowledge.db');
  const { child, readLog } = spawnSidecar({
    HOME: home, SQLITE_PATH: dbPath, DASHBOARD_PORT: String(port), SIDECAR_TOKEN: 'test-token',
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text',
  });
  let db: BetterSqlite3.Database | undefined;
  try {
    expect(await waitForSidecar(base), readLog()).toBe(true);
    db = new BetterSqlite3(dbPath);
    const rows = [
      { id: 'd1-null', project: null, source: 'claude-code', model: 'm1', at: '2026-10-05T00:00:00.000Z', input: 10 },
      { id: 'd1-empty', project: '', source: 'copilot-cli', model: 'm2', at: '2026-10-05T12:00:00.000Z', input: 20 },
      { id: 'd1-a', project: 'a', source: 'claude-code', model: 'm1', at: '2026-10-05T23:59:59.999Z', input: 30 },
      { id: 'd2-null', project: null, source: 'copilot-cli', model: 'm2', at: '2026-10-06T10:00:00.000Z', input: 40 },
      { id: 'd2-empty', project: '', source: 'claude-code', model: 'm1', at: '2026-10-06T14:00:00.000Z', input: 50 },
      { id: 'd2-a', project: 'a', source: 'copilot-cli', model: 'm2', at: '2026-10-06T23:59:59.999Z', input: 60 },
      { id: 'd3-null', project: null, source: 'claude-code', model: 'm1', at: '2026-10-07T00:00:00.000Z', input: 70 },
      { id: 'd3-empty', project: '', source: 'copilot-cli', model: 'm2', at: '2026-10-07T12:00:00.000Z', input: 80 },
      { id: 'd3-a', project: 'a', source: 'claude-code', model: 'm1', at: '2026-10-07T23:59:59.999Z', input: 90 },
      { id: 'd4-a', project: 'a', source: 'copilot-cli', model: 'm2', at: '2026-10-08T10:00:00.000Z', input: 100 },
    ];
    const insert = db.prepare(`INSERT INTO token_usage
      (id,source,model,project,session_id,message_id,occurred_at,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,scanned_at)
      VALUES (@id,@source,@model,@project,@id,@id,@at,@input,@output,@cacheRead,@cacheCreation,'2026-10-09T00:00:00.000Z')`);
    const insertMany = db.transaction(() => rows.forEach((row) => insert.run({
      ...row, output: row.input + 1, cacheRead: row.input + 2, cacheCreation: row.input + 3,
    })));
    insertMany();

    const query = async (from: string, to: string, filters: Record<string, string> = {}) => {
      const response = await authFetch(`${base}/api/token-usage?${new URLSearchParams({ from, to, ...filters })}`);
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    };
    const expected = (selected: typeof rows) => ({
      totals: {
        inputTokens: selected.reduce((sum, row) => sum + row.input, 0),
        outputTokens: selected.reduce((sum, row) => sum + row.input + 1, 0),
        cacheReadTokens: selected.reduce((sum, row) => sum + row.input + 2, 0),
        cacheCreationTokens: selected.reduce((sum, row) => sum + row.input + 3, 0),
      },
    });
    const dayRange = rows.filter((row) => row.at >= '2026-10-05T00:00:00.000Z' && row.at <= '2026-10-07T23:59:59.999Z');
    expect(await query('2026-10-05T00:00:00.000Z', '2026-10-07T23:59:59.999Z')).toMatchObject(expected(dayRange));
    expect(await query('2026-10-05T00:00:00.000Z', '2026-10-07T23:59:59.999Z', { project: 'a', source: 'claude-code', model: 'm1' }))
      .toMatchObject(expected(dayRange.filter((row) => row.project === 'a' && row.source === 'claude-code' && row.model === 'm1')));

    const partial = rows.filter((row) => row.at >= '2026-10-05T12:00:00.000Z' && row.at <= '2026-10-07T12:00:00.000Z');
    expect(await query('2026-10-05T12:00:00.000Z', '2026-10-07T12:00:00.000Z')).toMatchObject(expected(partial));
    expect(await query('2026-10-05T12:00:00.000Z', '2026-10-07T12:00:00.000Z', { project: 'a' }))
      .toMatchObject(expected(partial.filter((row) => row.project === 'a')));

    const inverted = await query('2026-10-07T00:00:00.000Z', '2026-10-06T00:00:00.000Z');
    expect(inverted.totals).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(inverted.byDay).toEqual([]);
    expect(inverted.byProject).toEqual([]);
    expect(inverted.byModel).toEqual([]);
    expect((await query('bogus', '2026-10-07T00:00:00.000Z')).totals).toBeDefined();

    const settings = await authFetch(`${base}/api/settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tokenUsageRetentionDays: 1 }),
    });
    expect(settings.status).toBe(200);
    // The sidecar runs retention on a six-hour timer; execute its same repository prune against
    // the sandbox database, leaving the request itself and all aggregate reads on the HTTP API.
    const cutoff = '2026-10-07T00:00:00.000Z';
    db.prepare("UPDATE token_usage_meta SET value=? WHERE key='pruned_before'").run(cutoff);
    db.prepare('DELETE FROM token_usage WHERE occurred_at < ?').run(cutoff);
    const acrossPrune = rows.filter((row) => row.at >= '2026-10-06T00:00:00.000Z' && row.at <= '2026-10-08T23:59:59.999Z');
    expect(await query('2026-10-06T00:00:00.000Z', '2026-10-08T23:59:59.999Z')).toMatchObject(expected(acrossPrune));
    expect(await query('2026-10-06T00:00:00.000Z', '2026-10-08T23:59:59.999Z', { project: 'a' }))
      .toMatchObject(expected(acrossPrune.filter((row) => row.project === 'a')));
  } finally {
    db?.close();
    await stopSidecar(child);
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});
