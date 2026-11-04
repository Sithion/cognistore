import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTheme } from '../../../../apps/dashboard/src/design/theme.js';

const widgetsDir = join(__dirname, '../../../../apps/dashboard/src/widgets');

describe('theme application', () => {
  it('emits exactly one themechange event per applyTheme call', () => {
    let count = 0;
    const onChange = () => { count += 1; };
    window.addEventListener('cognistore:themechange', onChange);
    applyTheme('dark');
    window.removeEventListener('cognistore:themechange', onChange);
    expect(count).toBe(1);
  });

  it('widget entry points never re-apply the theme from a themechange listener (recursion)', () => {
    const entries = readdirSync(widgetsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(widgetsDir, entry.name, 'main.tsx'))
      .filter(file => existsSync(file));
    expect(entries.length).toBeGreaterThan(0);
    for (const file of entries) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('cognistore:themechange');
    }
  });
});
