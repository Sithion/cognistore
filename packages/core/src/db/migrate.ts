import type BetterSqlite3 from 'better-sqlite3';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Versioned migration runner for SQLite.
 * Maintains a `schema_version` table, detects pre-migration databases,
 * and executes .sql files in semver order.
 */
export function runMigrations(sqlite: BetterSqlite3.Database, migrationsDir: string): void {
  // 1. Ensure schema_version table exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  // 2. Get already-applied versions
  const applied = new Set(
    (sqlite.prepare('SELECT version FROM schema_version').all() as { version: string }[])
      .map((r) => r.version)
  );

  // 3. Bootstrap: detect existing DB from pre-migration era
  if (applied.size === 0) {
    const tableExists = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_entries'")
      .get();

    if (tableExists) {
      sqlite
        .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run('0.8.0', new Date().toISOString());
      applied.add('0.8.0');
      console.log('Migration: bootstrapped existing DB as v0.8.0');
    }
  }

  // 4. Read and sort migration files by semver
  if (!existsSync(migrationsDir)) {
    console.warn('Migration: no migrations directory found, skipping');
    return;
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => compareSemver(a.replace('.sql', ''), b.replace('.sql', '')));

  // 5. Apply pending migrations
  for (const file of files) {
    const version = file.replace('.sql', '');
    if (applied.has(version)) continue;

    const sqlPath = resolve(migrationsDir, file);
    const sqlContent = readFileSync(sqlPath, 'utf-8');

    // Strip comment lines first, then split by semicolons
    const cleanedSql = sqlContent
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = cleanedSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        sqlite.exec(stmt + ';');
      } catch (err: any) {
        if (err?.message?.includes('duplicate column')) continue;
        if (err?.message?.includes('already exists')) continue;
        throw err;
      }
    }

    sqlite
      .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(version, new Date().toISOString());
    console.log(`Migration: ${version} applied`);
  }
}

/** Run seed files (only on fresh install — when schema_version was empty before migrations) */
export function runSeeds(sqlite: BetterSqlite3.Database, seedsDir: string, isFreshInstall: boolean): void {
  if (!isFreshInstall) return;
  if (!existsSync(seedsDir)) return;

  const files = readdirSync(seedsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sqlPath = resolve(seedsDir, file);
    const sqlContent = readFileSync(sqlPath, 'utf-8');
    sqlite.exec(sqlContent);
    console.log(`Seed: ${file} applied`);
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
