import { test, expect } from '../ui/browser-fixture.js';

test('@e2e Insights sections are routed and use the shared range',
  async ({ page, ui }) => {
    for (const path of ['/insights', '/insights/knowledge', '/insights/plans', '/insights/tokens']) {
      await page.goto(`${ui.url}${path}?preset=1m`);
      await expect(page.getByTestId('route-content')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Date range' })).toBeVisible();
      await expect(page.getByTestId('route-content')).not.toContainText('NaN');
    }
  });

test('@e2e chart failure has an actionable state', async ({ page, ui }) => {
  await page.route('**/api/token-usage?*', route =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto(`${ui.url}/insights/tokens`);
  await expect(page.getByTestId('screen-error')).toBeVisible();
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
});
