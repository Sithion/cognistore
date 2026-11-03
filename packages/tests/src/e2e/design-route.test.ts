import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createDbClient, KnowledgeRepository, KnowledgeService } from '@cognistore/core';
import { KnowledgeType, DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';
import { getFreePort, startMockOllama, TEST_TOKEN, waitForSidecar } from '../sidecar-helpers.js';
import { SERVER_ENTRY } from '../sidecar-helpers.js';

let sandbox = '';
let baseUrl = '';
let sidecar: ChildProcess | undefined;
let stopMock: (() => void) | undefined;

test.beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'cognistore-design-e2e-'));
  const dbPath = join(sandbox, 'knowledge.db');
  const { sqlite, db } = createDbClient(dbPath);
  const repository = new KnowledgeRepository(db, sqlite);
  const service = new KnowledgeService(repository, { async embed(text: string) { const vector = new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0); vector[0] = text.length || 1; return vector; } });
  for (const [title, content, tags] of [
    ['A reliable design token', 'Prefer semantic color tokens to hardcoded values.', ['design', 'frontend']],
    ['SQLite stays local', 'The sidecar keeps the knowledge base on this device.', ['privacy', 'sqlite']],
    ['Keyboard shortcuts', 'Use command palettes to make navigation fast.', ['ux', 'keyboard']],
  ] as const) {
    await service.add({ title, content, tags: [...tags], type: KnowledgeType.PATTERN, scope: 'workspace:cognistore', source: 'design-fixture', skipDedup: true });
  }
  sqlite.close();
  const mock = await startMockOllama('nomic-embed-text');
  stopMock = () => mock.server.close();
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  sidecar = spawn(process.execPath, [SERVER_ENTRY], { env: { ...process.env, HOME: sandbox, COGNISTORE_HOME: join(sandbox, '.cognistore'), SQLITE_PATH: dbPath, DASHBOARD_PORT: String(port), SIDECAR_TOKEN: TEST_TOKEN, OLLAMA_HOST: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'nomic-embed-text', DASHBOARD_DIST_PATH: resolve(dirname(SERVER_ENTRY), '../dist') }, stdio: 'ignore' });
  expect(await waitForSidecar(baseUrl)).toBe(true);
});

test.afterAll(() => {
  sidecar?.kill('SIGTERM');
  stopMock?.();
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

async function gotoViaNav(page: import('@playwright/test').Page, base: string, path: string) {
  // Hard navigation to a non-root SPA route 403s on the sidecar (known auth.ts isStaticPath gap):
  // load the root, then route client-side.
  // Setup/upgrade gating depends on the machine: answer "ready" so the app shows its pages.
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: { allReady: true } }));
  await page.route('**/api/upgrade/check', (route) => route.fulfill({ json: { needsUpgrade: false, fromVersion: null, toVersion: '0', isFirstInstall: false } }));
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
}

test('design route exposes the UI primitives and working controls', async ({ page }) => {
  await page.addInitScript((token) => { (window as any).__COGNISTORE_TOKEN__ = token; }, TEST_TOKEN);
  await gotoViaNav(page, baseUrl, '/_design');
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
  await expect(page.getByText('A reliable design token')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder('Search knowledge or navigate…')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'About this preview' }).click();
  await expect(page.getByRole('heading', { name: 'Design system preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await expect(page.getByRole('option', { name: 'Light' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('link', { name: 'Design system' }).click();
  await expect(page.getByRole('heading', { name: 'Component gallery' })).toBeVisible();
  await page.getByRole('button', { name: 'Show toast' }).click();
  await expect(page.getByText('Your changes have been saved')).toBeVisible();
});

test('knowledge selection routes to a side detail panel', async ({ page }) => {
  await page.addInitScript((token) => { (window as any).__COGNISTORE_TOKEN__ = token; }, TEST_TOKEN);
  await gotoViaNav(page, baseUrl, '/_design');
  await page.getByRole('button', { name: /A reliable design token/ }).click();
  const detail = page.getByTestId('knowledge-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Prefer semantic color tokens to hardcoded values.')).toBeVisible();
  await expect(detail.locator('.font-mono')).toContainText(/^[0-9a-f-]{36}$/);
  await expect(page).toHaveURL(/\/_design\/k\/[0-9a-f-]+$/);
});
