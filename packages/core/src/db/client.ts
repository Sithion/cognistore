import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { DEFAULT_SQLITE_PATH } from '@ai-knowledge/shared';
import * as schema from './schema/index.js';
import { createEmbeddingsTable } from './schema/sqlite-vec.js';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

  // Ensure schema exists (auto-create tables if missing)
  ensureSchema(sqlite);

  // Ensure virtual table exists
  createEmbeddingsTable(sqlite);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

function ensureSchema(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      type TEXT NOT NULL,
      scope TEXT NOT NULL,
      source TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      confidence_score REAL NOT NULL DEFAULT 1.0,
      related_ids TEXT,
      agent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_type ON knowledge_entries(type);
    CREATE INDEX IF NOT EXISTS idx_scope ON knowledge_entries(scope);
  `);
}
