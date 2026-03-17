import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDbClient } from './client.js';

export async function runMigrations(url?: string) {
  const { db, queryClient } = createDbClient(url);

  try {
    // Ensure pgvector extension exists
    await queryClient`CREATE EXTENSION IF NOT EXISTS vector`;

    await migrate(db, { migrationsFolder: new URL('./migrations', import.meta.url).pathname });
  } finally {
    await queryClient.end();
  }
}
