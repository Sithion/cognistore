import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { DEFAULT_SQLITE_PATH, DEFAULT_EMBEDDING_DIMENSIONS } from '@cognistore/shared';
import * as schema from './schema/index.js';
import { createEmbeddingsTable } from './schema/sqlite-vec.js';
import { createKnowledgeFtsTable } from './schema/fts.js';
import { runMigrations, runSeeds } from './migrate.js';
import { contentHash } from '../jobs/content-hash.js';
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
  sqlite.function('cognistore_content_hash', (title: string, content: string) => contentHash(title, content));
  sqlite.pragma('busy_timeout = 5000');
  for (let attempt = 0; ; attempt++) {
    try {
      sqlite.pragma('journal_mode = WAL');
      break;
    } catch (error: any) {
      if (error?.code !== 'SQLITE_BUSY' || attempt >= 49) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  sqlite.pragma('foreign_keys = ON');
  // Per-connection tuning (plan v2.6, 1A.1). NORMAL is durable with WAL: a
  // power cut can lose the last commits, never corrupt the file. The sidecar
  // and every MCP server go through here, so all connections match.
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = -32000'); // 32 MB page cache
  sqlite.pragma('mmap_size = 268435456'); // 256 MB of memory-mapped reads
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('journal_size_limit = 67108864'); // truncate the WAL back to 64 MB after checkpoints

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
  const dims = Number(process.env.EMBEDDING_DIMENSIONS) || DEFAULT_EMBEDDING_DIMENSIONS;
  createEmbeddingsTable(sqlite, dims);
  createPlansEmbeddingsTable(sqlite, dims);

  // Ensure the standalone FTS5 table exists. Full content repair runs in a worker.
  // Also ensure created_at indexes for fast ORDER BY created_at DESC LIMIT/OFFSET
  // (browse/infinite-scroll). All idempotent + best-effort — never block launch.
  try {
    createKnowledgeFtsTable(sqlite);
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_created_at ON knowledge_entries(created_at)');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_plans_created_at ON plans(created_at)');
  } catch {
    // FTS / indexes are optional optimizations — degrade gracefully if unavailable.
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

function createPlansEmbeddingsTable(sqlite: BetterSqlite3.Database, dimensions = DEFAULT_EMBEDDING_DIMENSIONS): void {
  try {
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS plans_embeddings USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[${dimensions}] distance_metric=cosine
      );
    `);
  } catch {
    // Table already exists
  }
}
