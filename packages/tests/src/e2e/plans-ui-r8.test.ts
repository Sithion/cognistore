import { test, expect } from '../ui/browser-fixture.js';

test('@e2e plan detail has tasks and survives reload', async ({ page, ui }) => {
  await page.goto(`${ui.url}/plans/${ui.planId}?scope=workspace%3Ar8`);
  const detail = page.getByTestId('plan-detail');
  await expect(detail).toContainText('Round eight plan');
  await expect(detail).toContainText('Migrate screens');
  await expect(detail.getByRole('progressbar')).toBeVisible();
  await page.reload();
  await expect(detail).toContainText('Migrate screens');
});

test('@e2e plans create real persisted records', async ({ page, ui }) => {
  await page.goto(`${ui.url}/plans`);
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Plan created in UI');
  await page.getByLabel('Content', { exact: true }).fill('A complete plan body.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('plan-detail')).toContainText('Plan created in UI');
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const response = await ui.call(`/api/plans/${id}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ title: 'Plan created in UI' });
});

test('@e2e plans retain status combinations and scope', async ({ page, ui }) => {
  await page.goto(`${ui.url}/plans?status=draft,active&scope=workspace%3Ar8&sort=updated&page=1`);
  await page.reload();
  const params = new URL(page.url()).searchParams;
  expect(params.get('status')).toBe('draft,active');
  expect(params.get('scope')).toBe('workspace:r8');
  await expect(page.getByText('Round eight plan', { exact: true }).first()).toBeVisible();
});
