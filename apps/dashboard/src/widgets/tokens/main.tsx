import React from 'react';
import ReactDOM from 'react-dom/client';
import '../shared/widget.css';
import { applyTheme, getThemeMode } from '../../design/theme.js';
import { TokenConsumptionWidget } from './TokenConsumptionWidget.js';

applyTheme(getThemeMode());
window.addEventListener('storage', event => { if (event.key === 'cognistore.theme') applyTheme(getThemeMode()); });
window.addEventListener('cognistore:themechange', event => applyTheme((event as CustomEvent<{ mode: 'light' | 'dark' | 'system' }>).detail.mode));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TokenConsumptionWidget />
  </React.StrictMode>,
);
