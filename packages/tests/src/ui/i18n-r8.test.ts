import { expect, it } from 'vitest';
import i18n from 'i18next';
import '../../../../apps/dashboard/src/i18n/index.js';
import { round8Shell } from '../../../../apps/dashboard/src/i18n/round8-shell.js';
import { round8Knowledge } from '../../../../apps/dashboard/src/i18n/round8-knowledge.js';
import { round8Plans } from '../../../../apps/dashboard/src/i18n/round8-plans.js';
import { round8Settings } from '../../../../apps/dashboard/src/i18n/round8-settings.js';
import { round8Insights } from '../../../../apps/dashboard/src/i18n/round8-insights.js';

// Screen bundles export resources rather than registering them on import.
for (const bundle of [round8Shell, round8Knowledge, round8Plans, round8Settings, round8Insights]) {
  for (const [language, resource] of Object.entries(bundle)) {
    i18n.addResourceBundle(language, 'translation', resource, true, true);
  }
}

function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key));
}

it('English and Portuguese have identical nonempty translation leaves', () => {
  const en = i18n.getResourceBundle('en', 'translation');
  const pt = i18n.getResourceBundle('pt', 'translation');
  expect(leaves(pt).sort()).toEqual(leaves(en).sort());
  for (const lang of ['en', 'pt']) {
    const resource = i18n.getResourceBundle(lang, 'translation');
    for (const key of leaves(resource)) {
      expect(String(i18n.getResource(lang, 'translation', key)).trim(),
        `${lang}:${key}`).not.toBe('');
    }
  }
});
