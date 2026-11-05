import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { makeDb } from './helpers.js';
import { runMigrations, EMBEDDED_MIGRATIONS, CurationRepository } from '../src/index.js';

let ctx: ReturnType<typeof makeDb> | undefined;
let legacy: BetterSqlite3.Database | undefined;
afterEach(() => { ctx?.cleanup(); legacy?.close(); legacy=undefined; });
function legacyDb() {
  const dir=mkdtempSync(join(tmpdir(),'cognistore-legacy-')); legacy=new BetterSqlite3(join(dir,'legacy.db'));
  legacy.exec(`CREATE TABLE schema_version(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
    CREATE TABLE knowledge_entries(id TEXT PRIMARY KEY,title TEXT NOT NULL DEFAULT '',content TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '[]',type TEXT NOT NULL,scope TEXT NOT NULL,source TEXT NOT NULL,updated_at TEXT NOT NULL,created_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,related_ids TEXT,content_hash TEXT);
    CREATE TABLE cleanup_candidates(id TEXT PRIMARY KEY,report_id TEXT NOT NULL,category TEXT NOT NULL,entry_ids TEXT NOT NULL,payload TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',resolution TEXT,updated_at TEXT NOT NULL);
    INSERT INTO schema_version(version,applied_at) VALUES('0.8.0','x'),('0.9.0','x'),('1.3.0','x'),('2.0.0','x'),('2.1.0','x'),('2.3.0','x'),('2.3.2','x'),('2.4.0','x'),('2.4.1','x'),('2.4.2','x'),('2.4.3','x'),('2.4.5','x');`);
  return legacy;
}

it('2.4.6 upgrades and reopens without losing legacy rows', async () => {
  const db=legacyDb();
  const add=(id:string,content:string,tags:string[]=[])=>db.prepare(`INSERT INTO knowledge_entries(id,title,content,tags,type,scope,source,created_at,updated_at) VALUES(?,?,?,?,'pattern','s','test','2020','2021')`).run(id,id,content,JSON.stringify(tags));
  add('old','legacy'); add('target','target'); add('sup','[SUPERSEDED by target] retained body'); add('keep','[SUPERSEDED by target] keep', ['keep']); add('bad','[SUPERSEDED by missing]'); add('self','[SUPERSEDED by self]'); add('deprecated','legacy',['deprecated']);
  runMigrations(db,new URL('../src/db/migrations',import.meta.url).pathname);
  const statuses=db.prepare('SELECT id,status,superseded_by,curated_at FROM knowledge_entries ORDER BY id').all();
  expect(statuses).toEqual(expect.arrayContaining([
    {id:'old',status:'active',superseded_by:null,curated_at:null},
    {id:'sup',status:'superseded',superseded_by:'target',curated_at:'2021'},
    {id:'keep',status:'active',superseded_by:null,curated_at:null},
    {id:'bad',status:'active',superseded_by:null,curated_at:null},
  ]));
  expect(db.prepare("SELECT content FROM knowledge_entries WHERE id='sup'").get()).toEqual({content:'[SUPERSEDED by target] retained body'});
  expect(db.prepare("SELECT tags FROM knowledge_entries WHERE id='deprecated'").get()).toEqual({tags:'["deprecated"]'});
  runMigrations(db,new URL('../src/db/migrations',import.meta.url).pathname);
  expect(db.prepare("SELECT count(*) AS n FROM schema_version WHERE version='2.4.6'").get()).toEqual({n:1});
});

it('curation migration failure rolls back schema and version', () => {
  const db=legacyDb(); const dir=mkdtempSync(join(tmpdir(),'cognistore-curation-fail-'));
  try { writeFileSync(join(dir,'2.4.6.sql'),`${EMBEDDED_MIGRATIONS['2.4.6']}\nINVALID SQL;`); expect(()=>runMigrations(db,dir)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='curation_runs'").get()).toBeUndefined();
    expect(db.prepare("SELECT version FROM schema_version WHERE version='2.4.6'").get()).toBeUndefined();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

it('snapshots round-trip tags vectors incoming references and plan relations', async () => {
  ctx=makeDb(); const a=await ctx.repository.create({title:'a',content:'a',tags:['x'],type:'pattern',scope:'p',source:'t',embedding:[1,...Array(255).fill(0)]});
  const b=await ctx.repository.create({title:'b',content:'b',tags:[],type:'pattern',scope:'p',source:'t',relatedIds:[a.id],embedding:Array(256).fill(0)});
  const plan=ctx.repository.createPlan({title:'p',content:'p',tags:[],scope:'p',source:'t',embedding:Array(256).fill(0)});
  ctx.repository.addPlanRelation(plan.id,a.id,'input');
  const snap=new CurationRepository(ctx.sqlite).captureSnapshot([a.id,b.id]);
  expect(snap.version).toBe(1); expect(snap.entries[a.id].tags).toBe('["x"]'); expect(snap.entries[a.id].embedding).toMatchObject({present:true,dimensions:256});
  expect(Buffer.from(snap.entries[a.id].embedding.bytesBase64!,'base64')).toEqual(Buffer.from(new Float32Array([1,...Array(255).fill(0)]).buffer));
  expect(snap.incomingReferences[a.id]).toContain(b.id); expect(snap.planRelations).toContainEqual(expect.objectContaining({planId:plan.id,knowledgeId:a.id,relationType:'input'}));
});

it('queue pagination and leases use bounded indexed queries', () => {
  ctx=makeDb(); const repo=new CurationRepository(ctx.sqlite), now=new Date().toISOString();
  const ins=ctx.sqlite.prepare("INSERT INTO curation_runs(id,started_at,trigger,model,status,cursor,updated_at) VALUES(?,?,?,'m','running','{}',?)");
  for(const id of ['a','b','c']) ins.run(id,now,'manual',now);
  expect(repo.listRuns(null,2)).toHaveLength(2); expect(repo.listRuns({updatedAt:now,id:'b'},2).map((r:any)=>r.id)).toEqual(['c']);
  expect(repo.acquireLease('a','one',now,'2099')).toBe(true); expect(repo.acquireLease('a','two',now,'2099')).toBe(false); expect(repo.acquireLease('a','two','2100','2200')).toBe(true);
});
