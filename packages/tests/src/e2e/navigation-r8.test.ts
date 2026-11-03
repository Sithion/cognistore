import { test, expect } from '../ui/browser-fixture.js';

const destinations = [
  '/', '/knowledge', '/knowledge/tags', '/plans',
  '/curation', '/curation/history', '/curation/trash',
  '/insights', '/insights/knowledge', '/insights/plans',
  '/insights/tokens', '/integrations/agents',
  '/integrations/providers', '/settings/general', '/settings/models',
  '/settings/curation', '/settings/telemetry', '/settings/advanced',
  '/system/health', '/system/about',
];

test('@e2e every public destination supports hard navigation and reload',
  async ({ page, ui }) => {
    test.setTimeout(240_000);
    for (const path of destinations) {
      const response = await page.goto(`${ui.url}${path}`);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByTestId('route-content')).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('route-content')).toBeVisible();
    }
  });

test('@e2e destinations are reachable through navigation or palette',
  async ({ page, ui }) => {
    test.setTimeout(240_000);
    await page.goto(ui.url);
    for (const path of destinations) {
      const nav = page.locator(`nav a[href="${path}"]`);
      if (await nav.count()) await nav.first().click();
      else {
        await page.keyboard.press('Control+k');
        await page.getByTestId('command-search').fill(path);
        await page.getByRole('option').filter({ hasText: path }).first().click();
      }
      await expect(page).toHaveURL(`${ui.url}${path}`);
    }
    const links = await page.locator('nav a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')!));
    for (const href of links) expect(destinations).toContain(href);
  });

test('@e2e old URLs retain their meaning and scope', async ({ page, ui }) => {
  const redirects = [
    [`/?edit=${ui.entryId}&scope=workspace%3Ar8`, `/knowledge/${ui.entryId}`],
    [`/plans?select=${ui.planId}&scope=workspace%3Ar8`, `/plans/${ui.planId}`],
    ['/stats', '/insights/knowledge'], ['/stats/plans', '/insights/plans'],
    ['/tokens', '/insights/tokens'], ['/providers', '/integrations/providers'],
    ['/widgets', '/integrations/widgets'], ['/settings', '/settings/general'],
  ];
  for (const [oldPath, newPath] of redirects) {
    await page.goto(`${ui.url}${oldPath}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe(newPath);
    if (oldPath.includes('scope=')) expect(new URL(page.url()).searchParams.get('scope')).toBe('workspace:r8');
  }
});

test('@e2e global shortcuts do not steal typed input', async ({ page, ui }) => {
  await page.goto(`${ui.url}/knowledge`);
  await page.keyboard.press('g'); await page.keyboard.press('p');
  await expect(page).toHaveURL(`${ui.url}/plans`);
  await page.keyboard.press('g'); await page.keyboard.press('k');
  await expect(page).toHaveURL(`${ui.url}/knowledge`);
  const search = page.getByTestId('knowledge-search');
  await search.fill('g p / n ?');
  await expect(search).toHaveValue('g p / n ?');
  expect(new URL(page.url()).pathname).toBe('/knowledge');
});

test('@e2e document access does not grant API access', async ({ ui }) => {
  expect((await fetch(`${ui.url}/settings/telemetry`)).status).toBe(200);
  for (const path of ['/api/settings', '/api/plans', '/api/knowledge/recent']) expect((await fetch(`${ui.url}${path}`)).status).toBe(403);
  expect((await ui.call('/api/route-that-does-not-exist')).status).toBe(404);
  const response = await fetch(`${ui.url}/settings/telemetry`, { headers: { Origin: 'https://evil.example' } });
  expect(response.status).toBe(403);
});
