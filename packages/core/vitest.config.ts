import { defineConfig } from 'vitest/config';

// Unit layer for core (plan v2.6, T.2): repositories and services against a
// real temporary on-disk SQLite + sqlite-vec, with a stub embedder. The sidecar and
// MCP end-to-end suites live in packages/tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Schema DDL and the barrel files hold no logic of their own.
      // Worker entries are covered by the integration layer.
      exclude: ['src/**/index.ts', 'src/db/migrations/**', 'src/db/seeds/**', 'src/jobs/*-worker.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
