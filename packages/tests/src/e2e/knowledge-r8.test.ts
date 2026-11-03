import { test, expect } from '../ui/browser-fixture.js';

test('@e2e knowledge detail is addressable and Back closes it',
  async ({ page, ui }) => {
    await page.goto(`${ui.url}/knowledge?scope=workspace%3Ar8`);
    await page.getByTestId('knowledge-row')
      .filter({ hasText: 'Round eight knowledge' }).click();
    await expect(page).toHaveURL(new RegExp(`/knowledge/${ui.entryId}`));
    await expect(page.getByTestId('knowledge-detail')).toContainText('semantic navigation');
    await page.reload();
    await expect(page.getByTestId('knowledge-detail')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('knowledge-detail')).toHaveCount(0);
  });

test('@e2e knowledge creation uses the real API', async ({ page, ui }) => {
  await page.goto(`${ui.url}/knowledge`);
  await page.getByRole('button', { name: 'New knowledge', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Created through UI');
  await page.getByLabel('Content', { exact: true }).fill('Real persistence is required.');
  await page.getByLabel('Tags', { exact: true }).fill('round-eight');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('knowledge-row')
    .filter({ hasText: 'Created through UI' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('knowledge-row')
    .filter({ hasText: 'Created through UI' })).toBeVisible();
});

test('@e2e Base preserves combinable URL filters', async ({ page, ui }) => {
  await page.goto(`${ui.url}/knowledge?scope=workspace%3Ar8&tags=round-eight&type=pattern&view=compact`);
  await expect(page.getByTestId('knowledge-row')).toContainText('Round eight knowledge');
  await page.reload();
  const params = new URL(page.url()).searchParams;
  expect(params.get('scope')).toBe('workspace:r8');
  expect(params.get('tags')).toBe('round-eight');
  expect(params.get('type')).toBe('pattern');
  expect(params.get('view')).toBe('compact');
});
