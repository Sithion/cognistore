import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Bundle all workspace packages (sdk, core, embeddings, shared) inline
  // Keep npm packages and native modules as external dependencies
  noExternal: [
    '@ai-knowledge/sdk',
    '@ai-knowledge/shared',
    '@ai-knowledge/core',
    '@ai-knowledge/embeddings',
  ],
  external: [
    'better-sqlite3',
    'sqlite-vec',
    'drizzle-orm',
    '@modelcontextprotocol/sdk',
    'zod',
  ],
});
