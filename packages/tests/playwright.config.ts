import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  timeout: 60000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'e2e', testMatch: /e2e\/.*\.test\.ts/ },
    { name: 'load', testMatch: /load\/.*\.test\.ts/ },
    { name: 'performance', testMatch: /performance\/.*\.test\.ts/ },
  ],
});
