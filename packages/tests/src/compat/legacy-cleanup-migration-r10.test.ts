import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations, EMBEDDED_MIGRATIONS } from '../../../core/src/db/migrate.js';

// Round 10 (4.4): pending legacy cleanup candidates enter the curation queue through migration 2.4.6.
// The database is a temp file in a temp directory; nothing touches the real HOME.
const migrationDir = resolve(import.meta.dirname, '../../../core/src/db/migrations');
let dir: string;
let db: BetterSqlite3.Database;

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legacy-cleanup-r10-'));
  db = new BetterSqlite3(join(dir, 'legacy.db'));
  db.exec(`CREATE TABLE schema_version(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE knowledge_entries(id TEXT PRIMARY KEY,title TEXT NOT NULL DEFAULT '',content TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '[]',type TEXT NOT NULL,scope TEXT NOT NULL,source TEXT NOT NULL,updated_at TEXT NOT NULL,created_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,related_ids TEXT,content_hash TEXT);
    CREATE TABLE cleanup_reports(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',stats TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE cleanup_candidates(id TEXT PRIMARY KEY,report_id TEXT NOT NULL REFERENCES cleanup_reports(id) ON DELETE CASCADE,category TEXT NOT NULL,entry_ids TEXT NOT NULL,payload TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',resolution TEXT,updated_at TEXT NOT NULL);
    INSERT INTO schema_version(version,applied_at) VALUES('0.8.0','x'),('0.9.0','x'),('1.3.0','x'),('2.0.0','x'),('2.1.0','x'),('2.3.0','x'),('2.3.2','x'),('2.4.0','x'),('2.4.1','x'),('2.4.2','x'),('2.4.3','x'),('2.4.5','x');
    INSERT INTO cleanup_reports(id,created_at) VALUES('r1','2026-01-01T00:00:00.000Z');`);
  const add = db.prepare("INSERT INTO cleanup_candidates(id,report_id,category,entry_ids,status,updated_at) VALUES(?,?,?,?,?,?)");
  add.run('c-dup', 'r1', 'duplicate_group', '["e1","e2"]', 'pending', '2026-01-02T00:00:00.000Z');
  add.run('c-dep', 'r1', 'deprecated', '["e3"]', 'pending', '2026-01-03T00:00:00.000Z');
  add.run('c-unread', 'r1', 'unread', '["e4"]', 'pending', '2026-01-04T00:00:00.000Z');
  add.run('c-done', 'r1', 'unread', '["e5"]', 'applied', '2026-01-05T00:00:00.000Z');
  add.run('c-dismissed', 'r1', 'deprecated', '["e6"]', 'dismissed', '2026-01-06T00:00:00.000Z');
  add.run('c-empty', 'r1', 'deprecated', '[]', 'pending', '2026-01-07T00:00:00.000Z');
});
test.afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const migrated = () => db.prepare("SELECT kind,actor,status,entry_ids,idempotency_key,created_at,payload FROM curation_actions WHERE actor='legacy-cleanup' ORDER BY idempotency_key").all() as
  { kind: string; actor: string; status: string; entry_ids: string; idempotency_key: string; created_at: string; payload: string }[];

test('pending candidates become proposed flag actions with the suggestion in the payload', () => {
  runMigrations(db, migrationDir);
  const rows = migrated();
  expect(rows.map(r => r.idempotency_key)).toEqual(['legacy-cleanup:c-dep', 'legacy-cleanup:c-dup', 'legacy-cleanup:c-unread']);
  expect(rows.every(r => r.kind === 'flag' && r.status === 'proposed')).toBe(true);
  const dup = rows.find(r => r.idempotency_key === 'legacy-cleanup:c-dup')!;
  expect(JSON.parse(dup.entry_ids)).toEqual(['e1', 'e2']);
  expect(dup.created_at).toBe('2026-01-02T00:00:00.000Z');
  expect(JSON.parse(dup.payload)).toMatchObject({ suggestedKind: 'merge', legacy: { candidateId: 'c-dup', reportId: 'r1', category: 'duplicate_group' } });
  expect(JSON.parse(rows.find(r => r.idempotency_key === 'legacy-cleanup:c-dep')!.payload)).toMatchObject({ suggestedKind: 'trash' });
});

test('running the migration SQL again adds no duplicates and the old tables stay intact', () => {
  runMigrations(db, migrationDir);
  // The migration runner skips an applied version; re-run the statements themselves to prove idempotence.
  const insert = readFileSync(join(migrationDir, '2.4.6.sql'), 'utf8').split('-- Round 10: carry')[1];
  db.exec(insert.slice(insert.indexOf('INSERT OR IGNORE')));
  db.exec(insert.slice(insert.indexOf('INSERT OR IGNORE')));
  expect(migrated()).toHaveLength(3);
  expect((db.prepare('SELECT COUNT(*) AS n FROM cleanup_candidates').get() as { n: number }).n).toBe(6);
  expect((db.prepare("SELECT status FROM cleanup_candidates WHERE id='c-dup'").get() as { status: string }).status).toBe('pending');
});

test('the disk migration and the embedded copy are byte-identical', () => {
  expect(EMBEDDED_MIGRATIONS['2.4.6']).toBe(readFileSync(join(migrationDir, '2.4.6.sql'), 'utf8'));
});
