import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store/index.js';
import './i18n/index.js';
import './styles.css';
import { Toaster } from './components/ui/sonner.js';
import { App } from './App.js';
import { applyTheme, getThemeMode } from './design/theme.js';

applyTheme(getThemeMode());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Toaster position="bottom-right" />
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);
