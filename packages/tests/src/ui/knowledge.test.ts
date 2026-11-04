import { createElement } from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderScreen } from './fixture.js';
import { api } from '../../../../apps/dashboard/src/api/client.js';
import { KnowledgeEditor } from '../../../../apps/dashboard/src/knowledge/KnowledgeEditor.js';

it('sends a title and retains the editor after failure', async () => {
  const create = vi.spyOn(api, 'create').mockRejectedValue(new Error('private detail'));
  const saved = vi.fn();
  renderScreen(createElement(KnowledgeEditor, {
    onSaved: saved, onCancel: vi.fn(),
  }), '/knowledge?new=1');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Useful title' } });
  fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'Useful content' } });
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'ui' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0][0]).toMatchObject({
    title: 'Useful title', content: 'Useful content', tags: ['ui'],
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('private detail')).toBeNull();
  expect(screen.getByLabelText('Title')).toBeTruthy();
  expect(saved).not.toHaveBeenCalled();
});
