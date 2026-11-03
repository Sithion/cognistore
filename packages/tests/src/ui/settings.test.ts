import { createElement } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RetentionField } from '../../../../apps/dashboard/src/settings/RetentionField.js';

it('accepts 0 and keeps a failed draft', async () => {
  const save = vi.fn().mockRejectedValue(new Error('private detail'));
  render(createElement(RetentionField, { value: 90, onSave: save }));
  const input = screen.getByTestId('retention-days');
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.click(screen.getByTestId('retention-save'));
  await waitFor(() => expect(save).toHaveBeenCalledWith(0));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((input as HTMLInputElement).value).toBe('0');
  expect(screen.queryByText('private detail')).toBeNull();
});

it.each(['', '-1', '1.5', '36501'])('does not submit invalid value %s', value => {
  const save = vi.fn();
  render(createElement(RetentionField, { value: 90, onSave: save }));
  fireEvent.change(screen.getByTestId('retention-days'), { target: { value } });
  fireEvent.click(screen.getByTestId('retention-save'));
  expect(save).not.toHaveBeenCalled();
});
