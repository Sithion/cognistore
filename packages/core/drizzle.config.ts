import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './dist/db/schema/knowledge.js',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://knowledge:knowledge_secret@localhost:5433/knowledge_base',
  },
});
