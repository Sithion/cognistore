import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'widget-stats': resolve(__dirname, 'widgets/stats.html'),
        'widget-plans': resolve(__dirname, 'widgets/plans.html'),
        'widget-active-plans': resolve(__dirname, 'widgets/active-plans.html'),
        'widget-tokens': resolve(__dirname, 'widgets/tokens.html'),
      },
    },
  },
});
