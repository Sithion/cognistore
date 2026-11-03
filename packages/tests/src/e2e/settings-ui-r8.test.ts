import { test, expect } from '../ui/browser-fixture.js';

test('@e2e retention is numeric, persisted, and reloadable', async ({ page, ui }) => {
  await page.goto(`${ui.url}/settings/telemetry`);
  await expect(page.getByTestId('retention-days')).toHaveValue('90');
  for (const days of [180, 0, 90]) {
    await page.getByTestId('retention-days').fill(String(days));
    const saved = page.waitForResponse(response =>
      response.url().endsWith('/api/settings') &&
      response.request().method() === 'PUT');
    await page.getByTestId('retention-save').click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(page.getByTestId('retention-days')).toHaveValue(String(days));
    const response = await ui.call('/api/settings');
    expect((await response.json()).tokenUsageRetentionDays).toBe(days);
  }
});

test('@e2e opening routed settings never starts duplicate computation',
  async ({ page, ui }) => {
    let duplicateRequests = 0;
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/health/duplicates') {
        duplicateRequests++;
      }
    });
    for (const section of ['general', 'models', 'curation', 'telemetry', 'advanced']) {
      await page.goto(`${ui.url}/settings/${section}`);
      await expect(page.getByTestId('route-content')).toBeVisible();
    }
    expect(duplicateRequests).toBe(0);
  });

test('@e2e extracted tools have their own URLs', async ({ page, ui }) => {
  for (const path of ['/knowledge/tags', '/curation', '/system/health', '/integrations/agents']) {
    await page.goto(`${ui.url}${path}`);
    await expect(page.getByTestId('route-content')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
  }
});
