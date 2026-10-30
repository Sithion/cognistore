import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authFetch, getFreePort, spawnSidecar, waitForSidecar, stopSidecar, startMockOllama, TEST_TOKEN } from '../sidecar-helpers.js';

test('HTTP export retains filename, JSON fields, and include behavior', async () => {
  const home = mkdtempSync(join(tmpdir(), 'r5-export-http-'));
  const exportTmp = mkdtempSync(join(tmpdir(), 'r5-export-tmp-'));
  const mock = await startMockOllama('nomic-embed-text');
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  const { child, readLog } = spawnSidecar({
    HOME: home, COGNISTORE_HOME: join(home, '.cognistore'), SQLITE_PATH: join(home, 'db'),
    DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN, TMPDIR: exportTmp,
    OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text',
  });
  try {
    expect(await waitForSidecar(base), readLog()).toBe(true);
    for (const include of ['knowledge', 'plans', 'knowledge,plans']) {
      const response = await authFetch(`${base}/api/export?include=${include}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="cognistore-export.json"');
      expect(response.headers.get('content-type')).toContain('application/json');
      const body = await response.json();
      expect(Object.keys(body).sort()).toEqual(['version', 'exportedAt', ...include.split(',')].sort());
      expect(body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      for (const key of include.split(',')) expect(Array.isArray(body[key])).toBe(true);
    }
    const controller = new AbortController();
    const response = await authFetch(`${base}/api/export`, { signal: controller.signal });
    controller.abort();
    await response.body?.cancel().catch(() => {});
    expect((await authFetch(`${base}/api/health`)).status).toBe(200);
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && (await import('node:fs')).readdirSync(exportTmp).some((name) => name.startsWith('cognistore-export-'))) await new Promise((r) => setTimeout(r, 25));
    expect((await import('node:fs')).readdirSync(exportTmp).some((name) => name.startsWith('cognistore-export-'))).toBe(false);
  } finally {
    await stopSidecar(child);
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
    rmSync(exportTmp, { recursive: true, force: true });
  }
});
