import { test, expect, chromium, type Browser } from '@playwright/test';
import { type Server } from 'node:http';
import { type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authFetch,
  SERVER_ENTRY,
  TEST_TOKEN,
  getFreePort,
  startMockOllama,
  spawnSidecar,
  waitForSidecar,
  stopSidecar,
} from '../sidecar-helpers.js';
import { createDuplicatesCache } from '../../../../apps/dashboard/server/duplicates-cache.js';

/**
 * Plan v2.6 item 1A.5 — duplicate detection is a full scan of the base, so the
 * Settings page must not run it on mount: only the "Check for duplicates"
 * button calls /api/health/duplicates, and the route caches its result per
 * base fingerprint.
 *
 * The browser half drives the REAL built dashboard (apps/dashboard/dist) served
 * by the REAL sidecar in Chromium. It needs `pnpm build` and
 * `npx playwright install chromium`; a missing browser fails the test on
 * purpose — the claim "opening Settings does not hit the route" must be proven,
 * not skipped.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIST = resolve(__dirname, '../../../../apps/dashboard/dist');
const DUP_ROUTE = '/api/health/duplicates';

test.describe('duplicates cache (unit)', () => {
  test('reuses the value while the fingerprint and options are unchanged', async () => {
    let fp = 'a';
    let calls = 0;
    const cache = createDuplicatesCache<number>(() => fp);
    const compute = async () => ++calls;
    expect(await cache.get('{}', compute)).toEqual({ value: 1, hit: false });
    expect(await cache.get('{}', compute)).toEqual({ value: 1, hit: true });
    expect(await cache.get('{"limit":5}', compute)).toEqual({ value: 2, hit: false });
    fp = 'b';
    expect(await cache.get('{"limit":5}', compute)).toEqual({ value: 3, hit: false });
    cache.clear();
    expect(await cache.get('{"limit":5}', compute)).toEqual({ value: 4, hit: false });
  });

  test('concurrent calls share one computation; failures are not cached', async () => {
    let calls = 0;
    const cache = createDuplicatesCache<number>(() => 'x');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => { calls++; await gate; return 7; };
    const p1 = cache.get('{}', slow);
    const p2 = cache.get('{}', slow);
    release();
    expect((await p1).value).toBe(7);
    expect(await p2).toEqual({ value: 7, hit: true });
    expect(calls).toBe(1);

    const failing = createDuplicatesCache<number>(() => 'y');
    await expect(failing.get('{}', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await failing.get('{}', async () => 9)).toEqual({ value: 9, hit: false });
  });
});

let child: ChildProcess;
let mock: { server: Server; port: number };
let baseUrl: string;
let tmpRoot: string;
let readServerLog: () => string = () => '';
let browser: Browser | undefined;

async function importEntries(entries: { title: string; content: string }[]) {
  const r = await authFetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      include: ['knowledge'],
      knowledge: entries.map((e) => ({ ...e, type: 'pattern', scope: 'global', source: 'e2e', tags: ['dup-test'] })),
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json() as { knowledge: { imported: number; errors: string[] } };
  expect(body.knowledge.errors).toEqual([]);
  expect(body.knowledge.imported).toBe(entries.length);
}

test.describe.serial('Settings duplicates on demand (real sidecar + Chromium)', () => {
  test.beforeAll(async () => {
    test.skip(!existsSync(SERVER_ENTRY), `built sidecar missing at ${SERVER_ENTRY} — run \`pnpm build\` first`);
    test.skip(!existsSync(join(DASHBOARD_DIST, 'index.html')), `built dashboard missing at ${DASHBOARD_DIST} — run \`pnpm build\` first`);

    const model = 'nomic-embed-text';
    tmpRoot = mkdtempSync(join(tmpdir(), 'cognistore-settings-dup-'));
    mock = await startMockOllama(model);
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const spawned = spawnSidecar({
      SQLITE_PATH: join(tmpRoot, 'knowledge.db'),
      COGNISTORE_HOME: join(tmpRoot, 'cognistore-home'),
      // The startup token scan reads homedir()/.claude/projects; keep it off the real HOME.
      HOME: tmpRoot,
      OLLAMA_HOST: `http://127.0.0.1:${mock.port}`,
      OLLAMA_MODEL: model,
      DASHBOARD_PORT: String(port),
      DASHBOARD_DIST_PATH: DASHBOARD_DIST,
      SIDECAR_TOKEN: TEST_TOKEN,
    });
    child = spawned.child;
    readServerLog = spawned.readLog;
    if (!(await waitForSidecar(baseUrl))) throw new Error(`sidecar never became ready.\n--- server log ---\n${readServerLog()}`);

    const content = 'Always wrap multi-row SQLite writes in a single transaction to avoid fsync per row.';
    await importEntries([
      { title: 'Batch SQLite writes in one transaction', content },
      { title: 'Batch SQLite writes in one transaction.', content },
    ]);
  });

  test.afterAll(async () => {
    await browser?.close();
    await stopSidecar(child);
    await new Promise<void>((res) => (mock?.server ? mock.server.close(() => res()) : res()));
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('opening Settings does not call the route; the button does, once', async () => {
    // Full Chromium (new headless) rather than the separate headless-shell
    // download: `playwright install chromium` provides both, and one binary
    // keeps local setups simpler.
    browser = await chromium.launch({ channel: 'chromium' });
    const page = await browser.newPage();
    // The Tauri shell injects the token; a plain browser needs it the same way.
    await page.addInitScript((token) => { (window as any).__COGNISTORE_TOKEN__ = token; }, TEST_TOKEN);
    // Setup/upgrade gating depends on the machine (Ollama binary, agent configs):
    // answer "ready" so the app goes straight to its pages. Everything else is real.
    await page.route('**/api/setup/status', (route) => route.fulfill({ json: { allReady: true } }));
    await page.route('**/api/upgrade/check', (route) =>
      route.fulfill({ json: { needsUpgrade: false, fromVersion: null, toVersion: '0', isFirstInstall: false } }));

    const dupRequests: string[] = [];
    page.on('request', (req) => { if (new URL(req.url()).pathname === DUP_ROUTE) dupRequests.push(req.url()); });

    // Like the Tauri webview: load the SPA shell at `/` (deep links are not static
    // paths and need the token), then route client-side to Settings.
    await page.goto(`${baseUrl}/`);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      window.history.pushState({}, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const button = page.getByTestId('check-duplicates');
    await expect(button).toBeVisible({ timeout: 20_000 });
    // The health section has finished its mount-time load (stale entries).
    await expect(page.getByText('No stale entries.')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(dupRequests).toHaveLength(0);
    await expect(page.getByText('No duplicates found.')).toHaveCount(0);

    const responsePromise = page.waitForResponse((r) => new URL(r.url()).pathname === DUP_ROUTE);
    await button.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page.getByText('2 similar entries')).toBeVisible();
    expect(dupRequests).toHaveLength(1);
  });

  test('the route caches per base fingerprint', async () => {
    const first = await authFetch(`${baseUrl}${DUP_ROUTE}`);
    const firstGroups = await first.json() as unknown[];
    // The browser test above already computed this exact (fingerprint, options) pair.
    expect(first.headers.get('x-cognistore-cache')).toBe('hit');
    expect(firstGroups).toHaveLength(1);

    const limited = await authFetch(`${baseUrl}${DUP_ROUTE}?limit=5`);
    expect(limited.headers.get('x-cognistore-cache')).toBe('miss');
    expect((await authFetch(`${baseUrl}${DUP_ROUTE}?limit=5`)).headers.get('x-cognistore-cache')).toBe('hit');

    // Any write changes the fingerprint.
    await importEntries([{ title: 'Unrelated entry', content: 'Tauri sidecar readiness handshake goes over stdout.' }]);
    const after = await authFetch(`${baseUrl}${DUP_ROUTE}`);
    expect(after.headers.get('x-cognistore-cache')).toBe('miss');
    expect(await after.json() as unknown[]).toHaveLength(1);
  });
});
