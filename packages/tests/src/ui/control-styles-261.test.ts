import { createElement } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import '../../../../apps/dashboard/src/i18n/index.js';
import { renderScreen } from './fixture.js';
import { api } from '../../../../apps/dashboard/src/api/client.js';
import { DateRangeControl } from '../../../../apps/dashboard/src/components/DateRangeControl.js';
import { controlClass, selectClass } from '../../../../apps/dashboard/src/components/ui/control-styles.js';
import { segment } from '../../../../apps/dashboard/src/components/ui/nav-styles.js';
import { store } from '../../../../apps/dashboard/src/store/index.js';
import { setPreset } from '../../../../apps/dashboard/src/store/dateRange.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  window.history.replaceState(null, '', '/');
  store.dispatch(setPreset('1w'));
  vi.spyOn(api, 'getSettings').mockResolvedValue({
    dateRangePreset: '1w',
    lastSelectedRange: null,
  } as Awaited<ReturnType<typeof api.getSettings>>);
});

describe('control styles for 2.6.1', () => {
  it('uses the standard field height, border, background and text size', () => {
    const classes = controlClass.split(/\s+/);
    for (const expected of ['h-9', 'border-input', 'bg-background', 'text-sm']) {
      expect(classes).toContain(expected);
    }
  });

  it('preserves every control class and reserves room for the native chevron', () => {
    const classes = selectClass.split(/\s+/);
    expect(classes).toContain('pr-8');
    for (const expected of controlClass.split(/\s+/)) {
      expect(classes).toContain(expected);
    }
  });

  it('uses an explicit 28px active segment without vertical padding', () => {
    const classes = segment(true).split(/\s+/);
    expect(classes).toContain('h-7');
    expect(classes).not.toContain('py-1');
  });

  it('uses an explicit 28px inactive segment without vertical padding', () => {
    const classes = segment(false).split(/\s+/);
    expect(classes).toContain('h-7');
    expect(classes).not.toContain('py-1');
  });

  it('renders every date-range segment with the shared height', async () => {
    renderScreen(createElement(DateRangeControl), '/knowledge?preset=1w');

    const group = screen.getByRole('group', { name: 'Date range' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect(button.classList.contains('h-7')).toBe(true);
      expect(button.classList.contains('py-1')).toBe(false);
    }

    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(1));
  });
});
