import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  timeout: 60000,
  retries: 0,
  // @perf suites are heavy (10k-entry fixture, ~1 min of duplicate detection) and
  // timing-sensitive: they run only via `test:perf` (PERF=1, one worker).
  grepInvert: process.env.PERF ? undefined : /@perf/,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'e2e', testMatch: /e2e\/.*\.test\.ts/ },
    { name: 'load', testMatch: /load\/.*\.test\.ts/ },
    // Compatibility net (plan v2.6, Fase T): the frozen MCP contract, the
    // upgrade and MCP × database matrices, and the sidecar API inventory.
    { name: 'compat', testMatch: /\/src\/(contract|compat|api)\/[^/]+\.test\.ts$/ },
    { name: 'performance', testMatch: /performance\/.*\.test\.ts/ },
  ],
});
