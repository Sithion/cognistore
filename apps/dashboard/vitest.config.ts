import { defineConfig } from 'vitest/config';

// Unit tests for the sidecar's pure modules (auth, settings). The sidecar's
// HTTP behaviour is tested end to end in packages/tests.
export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // The unit layer targets the pure modules; the rest of the server is
      // covered by the integration layer (packages/tests).
      include: ['server/auth.ts', 'server/settings.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
