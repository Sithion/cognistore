import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { DEFAULT_SQLITE_PATH } from '@ai-knowledge/shared';
import * as schema from './schema/index.js';
import { createEmbeddingsTable } from './schema/sqlite-vec.js';
import { runMigrations, runSeeds } from './migrate.js';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

export type Database = BetterSQLite3Database<typeof schema>;
export type SQLiteDatabase = BetterSqlite3.Database;

export function createDbClient(dbPath?: string): { db: Database; sqlite: SQLiteDatabase } {
  const resolvedPath = resolvePath(dbPath ?? process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH);

  // Ensure parent directory exists
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const sqlite = new BetterSqlite3(resolvedPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  // Load sqlite-vec extension
  sqliteVec.load(sqlite);

  // Check if this is a fresh install (no schema_version table yet, no knowledge_entries)
  const hasSchemaVersion = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
  const hasKnowledgeEntries = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_entries'").get();
  const isFreshInstall = !hasSchemaVersion && !hasKnowledgeEntries;

  // Run versioned migrations
  const migrationsDir = resolve(__dirname, 'migrations');
  const seedsDir = resolve(__dirname, 'seeds');
  runMigrations(sqlite, migrationsDir);
  runSeeds(sqlite, seedsDir, isFreshInstall);

  // Ensure sqlite-vec virtual tables (always idempotent)
  createEmbeddingsTable(sqlite);
  createPlansEmbeddingsTable(sqlite);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

function createPlansEmbeddingsTable(sqlite: BetterSqlite3.Database): void {
  try {
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS plans_embeddings USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384] distance_metric=cosine
      );
    `);
  } catch {
    // Table already exists
  }
}
