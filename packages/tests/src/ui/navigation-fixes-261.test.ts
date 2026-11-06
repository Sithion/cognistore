import { createElement, type ReactElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from 'i18next';
import '../../../../apps/dashboard/src/i18n/index.js';
import { searchWithout, usePlansRoute } from '../../../../apps/dashboard/src/plans/usePlansRoute.js';
import { ClickableBars } from '../../../../apps/dashboard/src/pages/StatsPage.js';

beforeAll(() => {
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(async () => { await i18n.changeLanguage('en'); });

function Probe() {
  const location = useLocation();
  return createElement('output', { 'data-testid': 'location' }, location.pathname + location.search);
}
function PlanControls() {
  const route = usePlansRoute();
  return createElement('div', null,
    createElement('button', { type: 'button', onClick: () => route.backToList() }, 'back'),
    createElement('button', { type: 'button', onClick: () => route.openPlan('B') }, 'open-b'));
}
function renderAt(path: string, element: ReactElement) {
  return render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null,
      createElement(Route, { path: '/plans/:id', element: createElement('div', null, element, createElement(Probe)) }),
      createElement(Route, { path: '/stats', element: createElement('div', null, element, createElement(Probe)) }),
      createElement(Route, { path: '*', element: createElement(Probe) }))));
}
const location = () => screen.getByTestId('location').textContent;
const bars = (data: { name: string; value: number }[]) =>
  createElement(ClickableBars, { data, dataKey: 'value', nameKey: 'name', color: '#000', destinationKey: 'scope' });
const chipTexts = () => screen.getAllByRole('listitem').map(li => li.textContent ?? '');

describe('plans navigation drops the stale select parameter', () => {
  it('searchWithout removes every select and keeps the other filters', () => {
    expect(searchWithout('?select=A&status=active&scope=global&sort=title&page=2')).toBe('?status=active&scope=global&sort=title&page=2');
    expect(searchWithout('?select=A&select=B')).toBe('');
    expect(searchWithout('')).toBe('');
  });
  it('backToList leaves the detail and keeps the list filters', () => {
    renderAt('/plans/A?select=A&status=active', createElement(PlanControls));
    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(location()).toBe('/plans?status=active');
  });
  it('openPlan opens the other plan instead of bouncing back to the current one', () => {
    renderAt('/plans/A?select=A', createElement(PlanControls));
    fireEvent.click(screen.getByRole('button', { name: 'open-b' }));
    expect(location()).toBe('/plans/B?select=B');
  });
});

describe('statistics chips', () => {
  const ten = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((name, i) => ({ name, value: [3, 10, 1, 7, 5, 9, 2, 8, 4, 6][i] }));
  it('shows the top eight and toggles the rest', () => {
    renderAt('/stats', bars(ten));
    expect(chipTexts()).toHaveLength(8);
    expect(chipTexts().some(t => t.startsWith('c'))).toBe(false); // value 1
    expect(chipTexts().some(t => t.startsWith('g'))).toBe(false); // value 2
    const toggle = screen.getByRole('button', { name: 'Show all (10)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(chipTexts()).toHaveLength(10);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    expect(location()).toBe('/stats');
    fireEvent.click(less);
    expect(chipTexts()).toHaveLength(8);
  });
  it('shows no toggle with eight items or fewer', () => {
    renderAt('/stats', bars(ten.slice(0, 8)));
    expect(chipTexts()).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
  it('orders by value and keeps input order for ties', () => {
    renderAt('/stats', bars([{ name: 'first', value: 5 }, { name: 'second', value: 5 }, { name: 'top', value: 9 }]));
    expect(chipTexts().map(t => t.split(' ')[0])).toEqual(['top', 'first', 'second']);
  });
  it('a chip opens the filtered knowledge list, not the overview', () => {
    renderAt('/stats', bars([{ name: 'workspace:x y', value: 2 }]));
    fireEvent.click(screen.getByRole('button', { name: /workspace:x y/ }));
    expect(location()).toBe('/knowledge?scope=workspace%3Ax%20y');
  });
});

describe('new translations exist in every language', () => {
  it.each([
    ['en', 'Show all (3)', 'Show less', 'Could not copy the path.'],
    ['es', 'Ver todo (3)', 'Ver menos', 'No se pudo copiar la ruta.'],
    ['pt', 'Ver todos (3)', 'Ver menos', 'Não foi possível copiar o caminho.'],
  ])('%s', (lng, showAll, showLess, copyFailed) => {
    const t = i18n.getFixedT(lng);
    expect(t('stats.showAll', { count: 3 })).toBe(showAll);
    expect(t('stats.showLess')).toBe(showLess);
    expect(t('planFile.copyFailed')).toBe(copyFailed);
  });
});
