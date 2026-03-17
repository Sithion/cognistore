import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDbClient } from './client.js';

export function runMigrations(dbPath?: string) {
  const { db, sqlite } = createDbClient(dbPath);

  try {
    migrate(db, { migrationsFolder: new URL('./migrations', import.meta.url).pathname });
  } finally {
    sqlite.close();
  }
}
