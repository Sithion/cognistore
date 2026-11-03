import { test, expect } from '../ui/browser-fixture.js';

test('@e2e date presets survive reload and Back', async ({ page, ui }) => {
  await page.goto(`${ui.url}/insights/tokens`);
  const range = page.getByRole('group', { name: 'Date range' });
  await range.getByRole('button', { name: '1 month', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('preset')).toBe('1m');
  await range.getByRole('button', { name: '1 week', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('preset')).toBe('1w');
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('preset')).toBe('1m');
  await page.reload();
  await expect(range.getByRole('button', { name: '1 month', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
});

test('@e2e calendar closes with Escape and restores focus', async ({ page, ui }) => {
  await page.goto(`${ui.url}/insights/tokens`);
  const trigger = page.getByRole('button', { name: 'Custom range' });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
