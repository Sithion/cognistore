import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DEFAULT_DATABASE_URL } from '@ai-knowledge/shared';
import * as schema from './schema/index.js';

export function createDbClient(url?: string) {
  const connectionString = url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const queryClient = postgres(connectionString);
  const db = drizzle(queryClient, { schema });
  return { db, queryClient };
}

export type Database = ReturnType<typeof createDbClient>['db'];
