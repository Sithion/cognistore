import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  noExternal: [
    '@ai-knowledge/core',
    '@ai-knowledge/sdk',
    '@ai-knowledge/shared',
    '@ai-knowledge/embeddings',
  ],
  external: [
    'better-sqlite3',
    'sqlite-vec',
  ],
});
