import { defineConfig } from 'drizzle-kit';
import { homedir } from 'node:os';

const defaultPath = (process.env.SQLITE_PATH ?? '~/.ai-knowledge/knowledge.db').replace('~', homedir());

export default defineConfig({
  schema: './dist/db/schema/knowledge.js',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: defaultPath,
  },
});
