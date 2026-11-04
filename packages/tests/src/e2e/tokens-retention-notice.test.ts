import { test, expect } from '../ui/browser-fixture.js';

test('@e2e Tokens links to the actual retention control', async ({ page, ui }) => {
  await page.goto(`${ui.url}/insights/tokens`);
  await page.getByTestId('retention-link').click();
  await expect(page).toHaveURL(`${ui.url}/settings/telemetry`);
  await expect(page.getByTestId('retention-days')).toHaveValue('90');
});

test('@e2e Tokens displays configured and unlimited retention', async ({ page, ui }) => {
  for (const days of [180, 0]) {
    const response = await ui.call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenUsageRetentionDays: days }),
    });
    expect(response.ok).toBe(true);
    await page.goto(`${ui.url}/insights/tokens`);
    const notice = page.getByTestId('retention-notice');
    if (days === 0) await expect(notice).toContainText(/unlimited/i);
    else await expect(notice).toContainText('180');
    await expect(notice).toContainText(/daily/i);
  }
});
