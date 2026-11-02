import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../../../apps/dashboard');

// The dashboard has no UI harness, so this pins the contract by source: every
// locale carries the notice with the retention interpolation and the settings
// link slot, and the page feeds it the configured retention (default 90).
test.describe('@e2e Tokens retention notice', () => {
  const i18n = readFileSync(resolve(root, 'src/i18n/index.ts'), 'utf-8');
  const page = readFileSync(resolve(root, 'src/pages/TokenConsumptionPage.tsx'), 'utf-8');

  test('all three locales define the notice with {{days}} and the settings link', () => {
    const lines = i18n.split('\n').filter((l) => l.includes('retentionNotice:'));
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain('{{days}}');
      expect(line).toMatch(/<settingsLink>.+<\/settingsLink>/);
    }
  });

  test('the page passes the configured retention and falls back to 90', () => {
    expect(page).toContain('tokens.retentionNotice');
    expect(page).toContain('tokenUsageRetentionDays');
    expect(page).toMatch(/useState\(90\)/);
    expect(page).toContain('to="/settings"');
  });
});
