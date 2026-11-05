import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authFetch, getFreePort, spawnSidecar, waitForSidecar,
  stopSidecar, startMockOllama, TEST_TOKEN,
} from '../sidecar-helpers.js';

test('imports an export above 1 MiB without raising other route limits', async () => {
  test.setTimeout(120_000);
  const home = mkdtempSync(join(tmpdir(), 'cognistore-import-limit-'));
  let child: ReturnType<typeof spawnSidecar>['child'] | undefined;
  let mock: Awaited<ReturnType<typeof startMockOllama>> | undefined;
  try {
    mock = await startMockOllama('nomic-embed-text');
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const spawned = spawnSidecar({
      HOME: home,
      COGNISTORE_HOME: join(home, '.cognistore'),
      COGNISTORE_MANAGED: '0',
      SQLITE_PATH: join(home, 'knowledge.db'),
      DASHBOARD_PORT: String(port),
      SIDECAR_TOKEN: TEST_TOKEN,
      TMPDIR: home,
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_DATA_HOME: join(home, 'data'),
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: 'nomic-embed-text',
    });
    child = spawned.child;
    expect(await waitForSidecar(base), spawned.readLog()).toBe(true);

    const knowledge = Array.from({ length: 4 }, (_, index) => ({
      title: `Large import fixture ${index}`,
      content: `${index}:` + 'synthetic fixture text '.repeat(14_000),
      tags: ['import-regression'],
      type: 'pattern',
      scope: 'global',
      source: 'test',
    }));
    const payload = JSON.stringify({ include: ['knowledge'], knowledge });
    expect(Buffer.byteLength(payload)).toBeGreaterThan(1024 * 1024);

    const initial = await authFetch(`${base}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      knowledge: { imported: 4, skipped: 0, errors: [] },
    });

    const exported = await authFetch(`${base}/api/export?include=knowledge`);
    expect(exported.status).toBe(200);
    const rawExport = await exported.text();
    expect(Buffer.byteLength(rawExport)).toBeGreaterThan(1024 * 1024);
    const exportBody = JSON.parse(rawExport);
    expect(exportBody.knowledge).toHaveLength(4);

    const roundTrip = await authFetch(`${base}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...exportBody, include: ['knowledge'] }),
    });
    expect(roundTrip.status).toBe(200);
    expect(await roundTrip.json()).toMatchObject({
      knowledge: { imported: 0, skipped: 4, errors: [] },
    });

    const otherRoute = await authFetch(`${base}/api/knowledge/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'x'.repeat(1024 * 1024 + 1) }),
    });
    expect(otherRoute.status).toBe(413);
  } finally {
    await stopSidecar(child);
    if (mock) {
      await new Promise<void>((resolve) => mock!.server.close(() => resolve()));
    }
    rmSync(home, { recursive: true, force: true });
  }
});
