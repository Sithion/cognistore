import { test, expect } from '../ui/browser-fixture.js';

test('@e2e first-run failure is visible and actionable', async ({ page, ui }) => {
  await page.unroute('**/api/setup/status');
  await page.route('**/api/setup/status', route => route.fulfill({ json: {
    allReady: false, nodeReady: false, ollamaInstalled: false,
    ollamaRunning: false, databaseReady: false, modelAvailable: false,
    configsReady: false, sdkReady: false,
  } }));
  await page.route('**/api/setup/node', route =>
    route.fulfill({ status: 500, json: { error: 'Unavailable' } }));
  await page.goto(ui.url);
  await page.getByRole('button', { name: /start|setup|install/i }).first().click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
});

test('@e2e upgrade progress is presented', async ({ page, ui }) => {
  await page.unroute('**/api/upgrade/check');
  await page.route('**/api/upgrade/check', route => route.fulfill({ json: {
    needsUpgrade: true, fromVersion: '2.5.3',
    toVersion: '2.5.4', isFirstInstall: false,
  } }));
  await page.route('**/api/upgrade/run', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ status: 500, json: { error: 'Unavailable' } });
  });
  await page.goto(ui.url);
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('@e2e Widgets explains desktop availability in browser mode', async ({ page, ui }) => {
  await page.goto(`${ui.url}/integrations/widgets`);
  await expect(page.getByTestId('route-content')).toContainText(/desktop/i);
  await expect(page.getByRole('button', { name: /open widget/i })).toHaveCount(0);
});

test('@e2e Providers is a canonical screen', async ({ page, ui }) => {
  await page.goto(`${ui.url}/integrations/providers`);
  await expect(page.getByTestId('route-content')).toBeVisible();
  await expect(page.getByRole('button', { name: /add provider/i })).toBeVisible();
});
