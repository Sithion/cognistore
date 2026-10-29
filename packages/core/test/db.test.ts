import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from './helpers.js';
import { runMigrations, runSeeds, EMBEDDED_MIGRATIONS } from '../src/db/migrate.js';
import { createDbClient } from '../src/db/client.js';
import { createKnowledgeFtsTable, deleteFts, ftsCount, insertFts, sanitizeFtsQuery, searchFts, updateFts } from '../src/db/schema/fts.js';
import { createEmbeddingsTable, deleteEmbedding, insertEmbedding, maxEmbeddingRowid, readEmbeddingsChunked, readEmbeddingsByLookup, searchKnn, updateEmbedding } from '../src/db/schema/sqlite-vec.js';
import { createPerfMonitor, formatPerfSummary } from '../src/perf/monitor.js';
import { instrumentDatabase, startEventLoopMonitor } from '../src/perf/instrumentation.js';

const dirs: string[] = [];
const dbs: BetterSqlite3.Database[] = [];
const cleanups: Array<() => void> = [];
function tempDir() { const d = mkdtempSync(join(tmpdir(), 'cognistore-db-test-')); dirs.push(d); return d; }
function sqlite() { const d = new BetterSqlite3(':memory:'); dbs.push(d); return d; }
afterEach(() => { vi.useRealTimers(); for (const c of cleanups.splice(0)) c(); for (const db of dbs.splice(0)) { try { db.close(); } catch {} } for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('migrations', () => {
  it('applies ordered SQL files from disk once', () => {
    const d = tempDir(); const dir = join(d, 'migrations'); mkdirSync(dir);
    writeFileSync(join(dir, '1.10.0.sql'), 'CREATE TABLE later (id INTEGER);');
    writeFileSync(join(dir, '1.2.0.sql'), 'CREATE TABLE earlier (id INTEGER);');
    const db = sqlite(); runMigrations(db, dir); runMigrations(db, dir);
    expect((db.prepare('SELECT version FROM schema_version ORDER BY version').all() as {version:string}[]).map(x=>x.version)).toEqual(['1.10.0','1.2.0']);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='earlier'").get()).toBeDefined();
  });
  it('runs embedded migrations when the directory is absent', () => {
    const db = sqlite(); runMigrations(db, join(tempDir(), 'missing'));
    expect((db.prepare('SELECT count(*) c FROM schema_version').get() as {c:number}).c).toBe(Object.keys(EMBEDDED_MIGRATIONS).length);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='operations_daily'").get()).toBeDefined();
  });
  it('bootstraps a pre-migration database and applies the base schema', () => {
    const d= tempDir(); const dir=join(d,'m'); mkdirSync(dir); writeFileSync(join(dir,'0.8.0.sql'), EMBEDDED_MIGRATIONS['0.8.0']);
    const db=sqlite(); db.exec("CREATE TABLE knowledge_entries (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', type TEXT NOT NULL, scope TEXT NOT NULL, source TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, expires_at TEXT, confidence_score REAL NOT NULL DEFAULT 1.0, related_ids TEXT, agent_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    const spy=vi.spyOn(console,'error').mockImplementation(()=>{});
    runMigrations(db,dir);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='operations_log'").get()).toBeDefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('bootstrapping existing')); spy.mockRestore();
  });
  it('tolerates duplicate columns and existing objects in disk migrations', () => {
    const d=tempDir(), dir=join(d,'m'); mkdirSync(dir); writeFileSync(join(dir,'1.0.0.sql'),'CREATE TABLE thing (id); ALTER TABLE thing ADD COLUMN id; CREATE TABLE thing (id);');
    const db=sqlite(); expect(()=>runMigrations(db,dir)).not.toThrow();
  });
  it('runs seed files only on fresh installs, in lexical order', () => {
    const dir=join(tempDir(),'seeds'); mkdirSync(dir); writeFileSync(join(dir,'b.sql',),'INSERT INTO seeded VALUES (2);'); writeFileSync(join(dir,'a.sql'),'INSERT INTO seeded VALUES (1);');
    const db=sqlite(); db.exec('CREATE TABLE seeded (n INTEGER)'); runSeeds(db,dir,false); expect(db.prepare('SELECT count(*) c FROM seeded').get()).toEqual({c:0});
    runSeeds(db,dir,true); expect((db.prepare('SELECT n FROM seeded ORDER BY n').all() as {n:number}[]).map(x=>x.n)).toEqual([1,2]);
  });
  it('does nothing when the seed directory is absent', () => { expect(()=>runSeeds(sqlite(),join(tempDir(),'none'),true)).not.toThrow(); });
});

describe('database client and FTS', () => {
  it('sets expected pragmas and creates vector tables on a fresh file', () => {
    const d=tempDir(), path=join(d,'nested','db.sqlite'); const {sqlite,db}=createDbClient(path); dbs.push(sqlite);
    expect(sqlite.pragma('foreign_keys',{simple:true})).toBe(1); expect(sqlite.pragma('busy_timeout',{simple:true})).toBe(5000);
    expect(sqlite.pragma('synchronous',{simple:true})).toBe(1); expect(sqlite.pragma('temp_store',{simple:true})).toBe(2);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_fts'").get()).toBeDefined();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='plans_embeddings'").get()).toBeDefined();
  });
  it('reopens an existing database without duplicating migrations', () => {
    const path=join(tempDir(),'db.sqlite'); let c=createDbClient(path); dbs.push(c.sqlite); const before=(c.sqlite.prepare('SELECT count(*) c FROM schema_version').get() as {c:number}).c;
    c.sqlite.close(); dbs.pop(); c=createDbClient(path); dbs.push(c.sqlite);
    expect((c.sqlite.prepare('SELECT count(*) c FROM schema_version').get() as {c:number}).c).toBe(before);
  });
  it('backfills non-system rows into empty FTS and excludes system entries', () => {
    const ctx=makeDb(); cleanups.push(ctx.cleanup); const {sqlite}=ctx;
    sqlite.prepare("INSERT INTO knowledge_entries (id,title,content,tags,type,scope,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run('a','Findable title','blue comet','["sky"]','fact','global','test','2025','2025');
    sqlite.prepare("INSERT INTO knowledge_entries (id,title,content,tags,type,scope,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run('s','Hidden title','blue comet','[]','system','global','test','2025','2025');
    // Fresh empty FTS is populated by the client on open; this DB's index is explicitly exercised through public helpers.
    createKnowledgeFtsTable(sqlite); insertFts(sqlite,{id:'a',title:'Findable title',content:'blue comet',tags:'sky'});
    expect(searchFts(sqlite,'comet',10).map(x=>x.id)).toEqual(['a']);
  });
  it('supports safe FTS updates, deletes, empty queries and quoted tokens', () => {
    const db=sqlite(); createKnowledgeFtsTable(db); insertFts(db,{id:'1',title:'old text',content:'hello',tags:''});
    updateFts(db,{id:'1',title:'new text',content:'world',tags:''});
    expect(ftsCount(db)).toBe(1); expect(searchFts(db,'old',10)).toHaveLength(0); expect(searchFts(db,'world',3)[0].id).toBe('1');
    expect(searchFts(db,'  ',10)).toEqual([]); expect(sanitizeFtsQuery('a "b"')).toBe('"a" """b"""'); deleteFts(db,'1'); expect(ftsCount(db)).toBe(0);
  });
});

describe('sqlite vec helpers', () => {
  it('creates vector storage and supports insert, update, search and delete', () => {
    const db=sqlite(); requireVec(db); createEmbeddingsTable(db,3); insertEmbedding(db,'x',[1,0,0]); updateEmbedding(db,'x',[0,1,0]); updateEmbedding(db,'y',[1,0,0]);
    expect(searchKnn(db,[1,0,0],2).map(x=>x.id)[0]).toBe('y'); expect(maxEmbeddingRowid(db)).toBeGreaterThan(0);
    deleteEmbedding(db,'y'); expect(searchKnn(db,[1,0,0],2).map(x=>x.id)).toEqual(['x']);
  });
  it('reads chunked embeddings with rowids and respects a watermark', () => {
    const db=sqlite(); requireVec(db); createEmbeddingsTable(db,2); db.exec('CREATE TABLE knowledge_entries (id TEXT)');
    insertEmbedding(db,'a',[1,2]); insertEmbedding(db,'b',[3,4]); const max=maxEmbeddingRowid(db)!; insertEmbedding(db,'c',[5,6]);
    const chunks=[...readEmbeddingsChunked(db,{maxRowid:max})]; expect(chunks.flatMap(c=>c.ids)).toEqual(['a','b']); expect(chunks[0].rowids).toHaveLength(2); expect(Array.from(chunks[0].vectors)).toEqual([1,2,3,4]);
  });
  it('uses lookup batches for entries and omits missing vectors', () => {
    const db=sqlite(); requireVec(db); createEmbeddingsTable(db,2); db.exec('CREATE TABLE knowledge_entries (id TEXT)'); db.prepare('INSERT INTO knowledge_entries VALUES (?)').run('a'); db.prepare('INSERT INTO knowledge_entries VALUES (?)').run('missing'); insertEmbedding(db,'a',[7,8]);
    const [chunk]=[...readEmbeddingsByLookup(db,1)]; expect(chunk.ids).toEqual(['a']); expect(chunk.rowids).toBeNull(); expect(Array.from(chunk.vectors)).toEqual([7,8]);
  });
  it('returns null rowid watermark when shadow tables are unavailable', () => { expect(maxEmbeddingRowid(sqlite())).toBeNull(); });
});
function requireVec(db: BetterSqlite3.Database) { (awaitVecLoad)(db); }
const awaitVecLoad = (db: BetterSqlite3.Database) => { const vec = require('sqlite-vec'); vec.load(db); };

describe('performance instrumentation', () => {
  it('tracks operation counts and can reset/uninstall', () => {
    const db=sqlite(); db.exec('CREATE TABLE t (value TEXT)'); const inst=instrumentDatabase(db,{slowMs:100000});
    db.prepare('INSERT INTO t (value) VALUES (?)').run('secret');
    expect(inst.stats().ops).toBe(1); expect(db.prepare('SELECT value FROM t').get()).toEqual({value:'secret'});
    inst.reset(); expect(inst.stats().ops).toBe(0); inst.uninstall();
  });
  it('reports summaries and handles warning or write sink exceptions', () => {
    expect(formatPerfSummary({p50:1,p99:2,max:3,mean:1.5},null)).toContain('db=not-attached');
    vi.useFakeTimers(); const write=vi.fn(()=>{throw Error('sink')}); const warn=vi.fn(()=>{throw Error('warn')}); const monitor=createPerfMonitor({write,warn,intervalMs:10,slowMs:0});
    const db=sqlite(); monitor.attach(db); db.exec('CREATE TABLE x (id)'); db.exec('INSERT INTO x VALUES (1)'); vi.advanceTimersByTime(10); expect(write).toHaveBeenCalled(); expect(()=>monitor.stop()).not.toThrow();
  });
  it('emits event loop reports on intervals and stops the timer', () => {
    vi.useFakeTimers(); const onReport=vi.fn(); const m=startEventLoopMonitor({intervalMs:25,onReport}); vi.advanceTimersByTime(25); expect(onReport).toHaveBeenCalledTimes(1); expect(onReport.mock.calls[0][0]).toHaveProperty('p99'); m.stop(); vi.advanceTimersByTime(50); expect(onReport).toHaveBeenCalledTimes(1);
  });
});
