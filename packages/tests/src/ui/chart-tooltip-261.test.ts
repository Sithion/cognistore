import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ChartTooltipContent,
  chartTooltipProps,
} from '../../../../apps/dashboard/src/insights/ChartTooltip.js';

describe('chart tooltips for 2.6.1', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(createElement(ChartTooltipContent, {
      active: false,
      label: 'Hidden',
      payload: [{ name: 'Input', value: 42 }],
    }));

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when payload is missing or empty', () => {
    const { container, rerender } = render(createElement(ChartTooltipContent, {
      active: true,
    }));

    expect(container.innerHTML).toBe('');

    rerender(createElement(ChartTooltipContent, {
      active: true,
      payload: [],
    }));

    expect(container.innerHTML).toBe('');
  });

  it('renders an area title and both formatted series with their colors', () => {
    const { container } = render(createElement(ChartTooltipContent, {
      active: true,
      label: '2026-11-01',
      payload: [
        { name: 'Input', value: 1234, color: '#8b5cf6' },
        { name: 'Output', value: 5, color: '#3b82f6' },
      ],
      format: (n: number) => new Intl.NumberFormat('en-US').format(n),
    }));

    expect(container.querySelector('p')?.textContent).toBe('2026-11-01');
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText('Output')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();

    const swatches = container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]');
    expect(swatches).toHaveLength(2);
    expect(swatches[0].style.backgroundColor).toBe('rgb(139, 92, 246)');
    expect(swatches[1].style.backgroundColor).toBe('rgb(59, 130, 246)');
  });

  it('hides the series key for a single bar item with a title', () => {
    render(createElement(ChartTooltipContent, {
      active: true,
      label: 'claude-opus',
      payload: [{ name: 'totalTokens', value: 42 }],
    }));

    expect(screen.getByText('claude-opus')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.queryByText('totalTokens')).toBeNull();
  });

  it('keeps the pie name without rendering a title paragraph', () => {
    const { container } = render(createElement(ChartTooltipContent, {
      active: true,
      payload: [{ name: 'completed', value: 3 }],
    }));

    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(container.querySelector('p')).toBeNull();
  });

  it('uses semantic popover and border classes on the root', () => {
    const { container } = render(createElement(ChartTooltipContent, {
      active: true,
      payload: [{ name: 'Input', value: 1 }],
    }));

    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    const classes = root!.className.split(/\s+/);
    expect(classes).toContain('bg-popover');
    expect(classes).toContain('border-border');
  });

  it('configures pie, bar, and area hover cursors', () => {
    expect(chartTooltipProps('pie').cursor).toBe(false);
    expect(chartTooltipProps('bar').cursor).toEqual({
      fill: 'var(--color-muted)',
      fillOpacity: 0.5,
    });
    expect(chartTooltipProps('area').cursor).toEqual({
      stroke: 'var(--color-border)',
      strokeWidth: 1,
    });
  });

  it('renders numeric zero as a title and falls back to the payload fill', () => {
    const { container } = render(createElement(ChartTooltipContent, {
      active: true,
      label: 0,
      payload: [{ name: 'totalTokens', value: 42, payload: { fill: '#22c55e' } }],
    }));

    expect(container.querySelector('p')?.textContent).toBe('0');
    expect(screen.queryByText('totalTokens')).toBeNull();
    expect(
      container.querySelector<HTMLElement>('span[aria-hidden="true"]')?.style.backgroundColor,
    ).toBe('rgb(34, 197, 94)');
  });

  it('keeps names for an empty label and preserves non-finite values', () => {
    const { container } = render(createElement(ChartTooltipContent, {
      active: true,
      label: '',
      payload: [{ name: 'Status', value: 'unavailable' }],
      format: (n: number) => `formatted:${n}`,
    }));

    expect(container.querySelector('p')).toBeNull();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('unavailable')).toBeTruthy();
    expect(screen.queryByText('formatted:NaN')).toBeNull();
  });

  it('supplies custom content, removes the outline, and disables animation', () => {
    const props = chartTooltipProps('area');

    expect(props.content).toBeTruthy();
    expect(props.wrapperStyle).toEqual({ outline: 'none' });
    expect(props.isAnimationActive).toBe(false);
  });
});
