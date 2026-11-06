import { createElement } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import '../../../../apps/dashboard/src/i18n/index.js';
import { renderScreen } from './fixture.js';
import { api } from '../../../../apps/dashboard/src/api/client.js';
import { DateRangeControl } from '../../../../apps/dashboard/src/components/DateRangeControl.js';
import { sectionTab, segment } from '../../../../apps/dashboard/src/components/ui/nav-styles.js';
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

describe('navigation styles for 2.6.1', () => {
  it('marks an active section with the primary underline', () => {
    const classes = sectionTab(true).split(/\s+/);
    expect(classes).toContain('border-primary');
    expect(classes).not.toContain('border-transparent');
  });

  it('keeps an inactive section underline transparent', () => {
    const classes = sectionTab(false).split(/\s+/);
    expect(classes).toContain('border-transparent');
    expect(classes).not.toContain('border-primary');
  });

  it('gives an active segment a background and shadow', () => {
    const classes = segment(true).split(/\s+/);
    expect(classes).toContain('bg-background');
    expect(classes).toContain('shadow-sm');
  });

  it('does not give an inactive segment a shadow', () => {
    const classes = segment(false).split(/\s+/);
    expect(classes).not.toContain('shadow-sm');
  });

  it('renders date presets and the inactive custom trigger in one segmented group', async () => {
    renderScreen(createElement(DateRangeControl), '/knowledge?preset=1w');

    const group = screen.getByRole('group', { name: 'Date range' });
    expect(group.classList.contains('bg-muted')).toBe(true);
    expect(within(group).getAllByRole('button')).toHaveLength(6);

    const active = within(group).getByRole('button', { name: '1 week' });
    expect(active.tagName).toBe('BUTTON');
    expect(active.getAttribute('type')).toBe('button');
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.classList.contains('shadow-sm')).toBe(true);

    for (const name of ['1 day', '1 month', '1 year', '2 years', 'Custom range']) {
      const button = within(group).getByRole('button', { name });
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.classList.contains('shadow-sm')).toBe(false);
    }

    const custom = within(group).getByRole('button', { name: 'Custom range' });
    expect(custom.getAttribute('aria-haspopup')).toBe('dialog');
    expect(custom.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(1));
  });

  it('renders a URL-selected custom range as the active segment with its existing accessible name', async () => {
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-07T23:59:59.999Z';
    const params = new URLSearchParams({ preset: 'custom', from, to });
    renderScreen(createElement(DateRangeControl), `/knowledge?${params}`);

    const group = screen.getByRole('group', { name: 'Date range' });
    const custom = within(group).getByRole('button', { name: 'Custom range' });
    await waitFor(() => expect(custom.getAttribute('aria-pressed')).toBe('true'));
    expect(group.classList.contains('bg-muted')).toBe(true);
    expect(custom.classList.contains('shadow-sm')).toBe(true);

    const format = (value: string) => new Date(value).toLocaleDateString(
      undefined, { month: 'short', day: 'numeric' },
    );
    expect(custom.textContent).toBe(`${format(from)} – ${format(to)}`);

    for (const name of ['1 day', '1 week', '1 month', '1 year', '2 years']) {
      const button = within(group).getByRole('button', { name });
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.classList.contains('shadow-sm')).toBe(false);
    }

    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(1));
  });
});
