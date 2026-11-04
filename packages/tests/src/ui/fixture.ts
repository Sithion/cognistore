import { type ComponentType, createElement, type ReactElement, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from '../../../../apps/dashboard/src/store/index.js';
import '../../../../apps/dashboard/src/i18n/index.js';

export function renderScreen(element: ReactElement, path = '/') {
  const Root = Provider as ComponentType<{ store: typeof store; children?: ReactNode }>;
  return render(createElement(
    Root, { store },
    createElement(MemoryRouter, { initialEntries: [path] }, element),
  ));
}
