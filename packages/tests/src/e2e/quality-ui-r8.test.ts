import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '../ui/browser-fixture.js';

const pages = [
  '/', '/knowledge', '/knowledge/tags', '/plans',
  '/curation', '/curation/history', '/curation/trash',
  '/insights', '/insights/knowledge', '/insights/plans',
  '/insights/tokens', '/integrations/agents', '/integrations/providers',
  '/settings/general', '/settings/models', '/settings/curation',
  '/settings/telemetry', '/settings/advanced', '/system/health', '/system/about',
];

for (const theme of ['dark', 'light']) {
  test(`@e2e all pages meet accessibility and visual contracts in ${theme}`,
    async ({ page, ui }) => {
      test.setTimeout(240_000);
      await page.addInitScript(mode => localStorage.setItem('cognistore.theme', mode), theme);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const path of pages) {
        await page.goto(`${ui.url}${path}`);
        await expect(page.getByTestId('route-content')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(result.violations.filter(v =>
          v.impact === 'serious' || v.impact === 'critical'), path).toEqual([]);
        expect(result.violations.filter(v => v.id === 'color-contrast'), path).toEqual([]);
        if (process.env.COGNISTORE_VISUAL === '1') {
          await expect(page).toHaveScreenshot(
            `${path === '/' ? 'home' : path.slice(1).replaceAll('/', '-')}-${theme}.png`,
            { animations: 'disabled', caret: 'hide' },
          );
        }
      }
    });
}

test('@e2e system theme follows live preference changes', async ({ page, ui }) => {
  await page.addInitScript(() => localStorage.setItem('cognistore.theme', 'system'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${ui.url}/knowledge`);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('@e2e keyboard focus returns from palette', async ({ page, ui }) => {
  await page.goto(`${ui.url}/knowledge`);
  const search = page.getByTestId('knowledge-search');
  await search.focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('command-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
});
