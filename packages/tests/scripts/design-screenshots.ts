// Captures the /_design gallery (dark + light) and the proof screen (list + detail panel +
// command palette) with Chromium into documentation/plans/reports/assets/rodada-7/.
// Run: pnpm --filter @cognistore/tests exec tsx scripts/design-screenshots.ts
// (needs the dashboard + sidecar built). WebKitGTK is covered by webkitgtk-probe.ts.
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { startHarness, OUTPUT_DIR } from './design-harness.ts';

async function gotoViaNav(page: Page, base: string, path: string) {
  // Hard navigation to a non-root SPA route 403s on the sidecar (known auth.ts isStaticPath gap):
  // load the root, then route client-side.
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: { allReady: true } }));
  await page.route('**/api/upgrade/check', (route) => route.fulfill({ json: { needsUpgrade: false, fromVersion: null, toVersion: '0', isFirstInstall: false } }));
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  await page.waitForLoadState('networkidle');
}

const harness = await startHarness();
try {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(([token]) => {
    window.localStorage.setItem('cognistore.theme', 'dark');
    (window as unknown as { __COGNISTORE_TOKEN__: string }).__COGNISTORE_TOKEN__ = token;
  }, [(await import('./design-harness.ts')).TEST_TOKEN]);
  const page = await context.newPage();

  await gotoViaNav(page, harness.baseUrl, '/_design/gallery');
  await page.getByRole('heading', { name: 'Component gallery' }).waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.screenshot({ path: join(OUTPUT_DIR, 'design-dark.png'), fullPage: true });
  await page.getByRole('switch', { name: 'Toggle dark theme' }).click();
  await page.getByRole('heading', { name: 'Component gallery' }).waitFor({ state: 'visible' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUTPUT_DIR, 'design-light.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoViaNav(page, harness.baseUrl, '/_design');
  await page.getByRole('button', { name: /A reliable design token/ }).click();
  const detail = page.getByTestId('knowledge-detail');
  await detail.waitFor({ state: 'visible' });
  await detail.getByText('A reliable design token').waitFor({ state: 'visible' });
  await page.keyboard.press('Control+k');
  await page.locator('[cmdk-root]').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(OUTPUT_DIR, 'proof-list-panel-palette.png'), fullPage: false });
  await browser.close();
  console.log('chromium screenshots written to', OUTPUT_DIR);
} finally {
  await harness.stop();
}
