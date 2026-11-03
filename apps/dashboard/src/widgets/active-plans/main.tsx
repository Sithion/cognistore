import React from 'react';
import ReactDOM from 'react-dom/client';
import '../shared/widget.css';
import { applyTheme, getThemeMode } from '../../design/theme.js';
import { ActivePlansWidget } from './ActivePlansWidget.js';

applyTheme(getThemeMode());
window.addEventListener('storage', event => { if (event.key === 'cognistore.theme') applyTheme(getThemeMode()); });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ActivePlansWidget />
  </React.StrictMode>,
);
