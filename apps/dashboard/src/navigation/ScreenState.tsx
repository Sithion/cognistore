import { createElement } from 'react';

export function ScreenState({ state, title, description, onRetry }: {
  state: 'loading' | 'empty' | 'error';
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return createElement('section', { 'data-testid': `screen-${state}`, role: state === 'error' ? 'alert' : 'status', className: 'screen-state' },
    createElement('h2', { className: 'screen-state-title' }, title),
    createElement('p', null, description),
    state === 'error' && onRetry ? createElement('button', { type: 'button', onClick: onRetry }, 'Retry') : null,
  );
}
