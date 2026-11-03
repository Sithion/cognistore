import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScreenState } from '../../../../apps/dashboard/src/navigation/ScreenState.js';

describe('shared screen states', () => {
  it.each(['loading', 'empty', 'error'] as const)('%s is visible', state => {
    render(createElement(ScreenState, {
      state, title: `State ${state}`, description: 'Useful guidance',
    }));
    expect(screen.getByTestId(`screen-${state}`)).toBeTruthy();
    expect(screen.getByText('Useful guidance')).toBeTruthy();
  });
  it('retries only on request', () => {
    const retry = vi.fn();
    render(createElement(ScreenState, {
      state: 'error', title: 'Could not load', description: 'Try again',
      onRetry: retry,
    }));
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
