import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../apps/dashboard/src', import.meta.url)),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    include: ['src/ui/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['src/ui/setup.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
