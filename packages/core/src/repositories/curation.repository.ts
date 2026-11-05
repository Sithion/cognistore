import type Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { contentHash } from '../jobs/content-hash.js';

export interface CurationSnapshotV1 {
  version: 1;
  entries: Record<string, Record<string, unknown> & { embedding: { present: boolean; bytesBase64?: string; dimensions?: number } }>;
  outgoingRelatedIds: Record<string, string[]>;
  incomingReferences: Record<string, string[]>;
  // Optional in v1: relation edits retain referrer rows; their vectors stay untouched.
  incomingEntries?: Record<string, Record<string, unknown>>;
  planRelations: { id?: number; planId: string; knowledgeId: string; relationType: string; createdAt: string }[];
}

export class CurationRepository {
  constructor(private sqlite: Database.Database) {}
  listRuns(after: { updatedAt: string; id: string } | null = null, limit = 100) {
    return page(this.sqlite, 'curation_runs', after, limit);
  }
  listActions(after: { createdAt: string; id: string } | null = null, limit = 100, runId?: string) {
    const cap = bounded(limit);
    return runId
      ? this.sqlite.prepare('SELECT * FROM curation_actions WHERE run_id = ? ORDER BY created_at, id LIMIT ?').all(runId, cap)
      : this.sqlite.prepare('SELECT * FROM curation_actions WHERE (? IS NULL OR (created_at, id) > (?, ?)) ORDER BY created_at, id LIMIT ?').all(after?.createdAt ?? null, after?.createdAt ?? '', after?.id ?? '', cap);
  }
  listVerdicts(afterId = '', limit = 100) {
    return this.sqlite.prepare('SELECT * FROM curation_verdicts WHERE id > ? ORDER BY id LIMIT ?').all(afterId, bounded(limit));
  }
  acquireLease(runId: string, owner: string, now: string, expiresAt: string): boolean {
    return this.sqlite.prepare(`UPDATE curation_runs SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND (lease_owner IS NULL OR lease_expires_at <= ? OR lease_owner = ?)`)
      .run(owner, expiresAt, now, runId, now, owner).changes === 1;
  }
  captureSnapshot(ids: string[], previousReferrers: string[] = []): CurationSnapshotV1 {
    const entries: CurationSnapshotV1['entries'] = {}, outgoingRelatedIds: Record<string,string[]> = {}, incomingReferences: Record<string,string[]> = {};
    const planRelations: CurationSnapshotV1['planRelations'] = [], unique = [...new Set(ids)].sort();
    const incomingEntries: NonNullable<CurationSnapshotV1['incomingEntries']> = {}, referrers = new Set(previousReferrers);
    const snapshotEntry = (row: Record<string, any>) => {
      const vector = this.sqlite.prepare('SELECT embedding FROM knowledge_embeddings WHERE id = ?').get(row.id) as {embedding:Buffer}|undefined;
      return {...row,embedding:vector?{present:true,bytesBase64:vector.embedding.toString('base64'),dimensions:vector.embedding.byteLength/4}:{present:false}};
    };
    for (let offset=0; offset<unique.length; offset+=100) {
      const batch=unique.slice(offset,offset+100), marks=batch.map(()=>'?').join(',');
      const rows=this.sqlite.prepare(`SELECT * FROM knowledge_entries WHERE id IN (${marks})`).all(...batch) as Record<string,any>[];
      for (const row of rows) {
        entries[row.id]=snapshotEntry(row);
        try { outgoingRelatedIds[row.id]=JSON.parse(row.related_ids??'[]'); } catch { outgoingRelatedIds[row.id]=[]; }
      }
      const refs=this.sqlite.prepare(`SELECT id FROM knowledge_entries WHERE ${batch.map(()=>"EXISTS (SELECT 1 FROM json_each(knowledge_entries.related_ids) WHERE value = ?)").join(' OR ')} ORDER BY id`).all(...batch) as {id:string}[];
      for (const ref of refs) if (!unique.includes(ref.id)) referrers.add(ref.id);
      for (const id of batch) incomingReferences[id]=refs.filter(ref=>Boolean(this.sqlite.prepare('SELECT 1 FROM knowledge_entries WHERE id=? AND EXISTS (SELECT 1 FROM json_each(related_ids) WHERE value=?)').get(ref.id,id))).map(ref=>ref.id);
      planRelations.push(...this.sqlite.prepare(`SELECT id, plan_id AS planId, knowledge_id AS knowledgeId, relation_type AS relationType, created_at AS createdAt FROM plan_relations WHERE knowledge_id IN (${marks}) ORDER BY knowledge_id,plan_id,relation_type`).all(...batch) as CurationSnapshotV1['planRelations']);
    }
    for (const id of [...referrers].sort()) {
      if (unique.includes(id)) continue;
      const row = this.getEntry(id);
      if (row) incomingEntries[id] = row;
    }
    return {version:1,entries,outgoingRelatedIds,incomingReferences,incomingEntries,planRelations};
  }
  transaction<T>(fn:()=>T):T { return this.sqlite.transaction(fn).immediate(); }
  listEligibleEntries(limit = 5000) {
    return this.sqlite.prepare(`SELECT id,title,content,content_hash AS contentHash,tags,type,scope,version,confidence_score AS confidenceScore,
      expires_at AS expiresAt,related_ids AS relatedIds,created_at AS createdAt,updated_at AS updatedAt,last_read_at AS lastReadAt,read_count AS readCount,status,superseded_by AS supersededBy
      FROM knowledge_entries WHERE status='active' AND type!='system' AND NOT EXISTS(SELECT 1 FROM json_each(knowledge_entries.tags) WHERE value='keep')
      ORDER BY scope,id LIMIT ?`).all(boundedItems(limit)) as any[];
  }
  listSupersededEntries(limit=5000) { return this.sqlite.prepare(`SELECT id,title,content,content_hash AS contentHash,tags,type,scope,version,confidence_score AS confidenceScore,expires_at AS expiresAt,related_ids AS relatedIds,created_at AS createdAt,updated_at AS updatedAt,last_read_at AS lastReadAt,read_count AS readCount,status,superseded_by AS supersededBy,curated_at AS curatedAt FROM knowledge_entries WHERE status='superseded' AND type!='system' AND NOT EXISTS(SELECT 1 FROM json_each(knowledge_entries.tags) WHERE value='keep') ORDER BY curated_at,id LIMIT ?`).all(boundedItems(limit)) as any[]; }
  getEntry(id:string) { return this.sqlite.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(id) as any; }
  readVector(id:string):number[]|null { const row=this.sqlite.prepare('SELECT embedding FROM knowledge_embeddings WHERE id=?').get(id) as {embedding:Buffer}|undefined; return row?.embedding?Array.from(new Float32Array(row.embedding.buffer,row.embedding.byteOffset,row.embedding.byteLength/4)):null; }
  mutateEntry(id:string, patch:{title?:string;content?:string;tags?:string[];status?:string;supersededBy?:string|null;relatedIds?:string[]}, now:string) {
    const row=this.getEntry(id); if(!row) throw new Error(`Entry ${id} disappeared`);
    if (protectedEntry(row)) throw new CurationConflict('Protected entry cannot be changed by curation');
    const title=patch.title??row.title, content=patch.content??row.content, tags=patch.tags??JSON.parse(row.tags);
    const status=patch.status??row.status, supersededBy=patch.supersededBy===undefined?row.superseded_by:patch.supersededBy;
    const related=patch.relatedIds??JSON.parse(row.related_ids??'[]');
    this.sqlite.prepare(`UPDATE knowledge_entries SET title=?,content=?,content_hash=?,tags=?,status=?,superseded_by=?,related_ids=?,curated_at=?,trashed_at=?,version=version+1,updated_at=? WHERE id=?`)
      .run(title,content,contentHash(title,content),JSON.stringify(tags),status,supersededBy,JSON.stringify(related),now,status==='trashed'?now:null,now,id);
    this.sqlite.prepare('DELETE FROM knowledge_fts WHERE id=?').run(id);
    if(status==='active') this.sqlite.prepare('INSERT INTO knowledge_fts(id,title,content,tags) VALUES(?,?,?,?)').run(id,title,content,tags.join(' '));
  }
  markActionApplied(id:string, now:string, after:unknown) { this.sqlite.prepare("UPDATE curation_actions SET status='applied',applied_at=?,after_snapshot=?,updated_at=? WHERE id=?").run(now,JSON.stringify(after),now,id); }
  listExpiredTrash(before:string,limit=100) { return this.sqlite.prepare("SELECT id FROM knowledge_entries WHERE status='trashed' AND trashed_at<? ORDER BY trashed_at,id LIMIT ?").all(before,bounded(limit)) as {id:string}[]; }
  purgeEntry(id:string,cutoff?:string):boolean|undefined {
    return this.transaction(() => {
    const row=this.sqlite.prepare('SELECT status,type,tags,trashed_at AS trashedAt FROM knowledge_entries WHERE id=?').get(id) as any;
    if (row && protectedEntry(row)) return undefined;
    if(!row||row.status!=='trashed'||cutoff&&(!row.trashedAt||row.trashedAt>=cutoff))return false;
    const referrers = this.sqlite.prepare('SELECT type,tags FROM knowledge_entries WHERE EXISTS(SELECT 1 FROM json_each(related_ids) WHERE value=?)').all(id) as any[];
    if (referrers.some(protectedEntry)) return undefined;
    this.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id=?').run(id); this.sqlite.prepare('DELETE FROM knowledge_fts WHERE id=?').run(id);
    this.sqlite.prepare('DELETE FROM plan_relations WHERE knowledge_id=?').run(id);
    this.sqlite.prepare(`UPDATE knowledge_entries SET related_ids=(SELECT COALESCE(json_group_array(value),'[]') FROM json_each(related_ids) WHERE value!=?) WHERE related_ids IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(related_ids) WHERE value=?)`).run(id,id);
    this.sqlite.prepare('DELETE FROM knowledge_entries WHERE id=?').run(id);
    const rows=this.sqlite.prepare('SELECT id,before_snapshot,after_snapshot FROM curation_actions WHERE entry_ids LIKE ? OR before_snapshot LIKE ? OR after_snapshot LIKE ?').all(`%${id}%`,`%${id}%`,`%${id}%`) as any[];
    const redact=(raw:string)=>{let obj:any;try{obj=JSON.parse(raw)}catch{return raw} if(!obj||typeof obj!=='object')return raw; if(obj.entries?.[id]) obj.entries[id]={purged:true}; if(obj.incomingEntries?.[id]) obj.incomingEntries[id]={purged:true}; return JSON.stringify(obj)};
    for(const row of rows) this.sqlite.prepare('UPDATE curation_actions SET before_snapshot=?,after_snapshot=?,payload=? WHERE id=?').run(redact(row.before_snapshot),redact(row.after_snapshot),'{"purged":true}',row.id);
    return true;
    });
  }
  getRun(id:string) { return this.sqlite.prepare('SELECT * FROM curation_runs WHERE id=?').get(id) as any; }
  createRun(id:string, options:unknown, now:string) {
    this.sqlite.prepare(`INSERT OR IGNORE INTO curation_runs(id,started_at,trigger,model,budget,stats,status,cursor,updated_at) VALUES(?,?,?,?,?,'{}','running','{}',?)`)
      .run(id,now,(options as any).trigger,(options as any).model,JSON.stringify(options),now);
    this.sqlite.prepare("UPDATE curation_runs SET status='running',finished_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status IN ('paused','failed')").run(now,id);
    return this.getRun(id);
  }
  checkpointRun(id:string, cursor:unknown, stats:unknown, status:'running'|'paused'|'completed'|'failed', now:string, failure?:unknown) {
    this.sqlite.prepare(`UPDATE curation_runs SET cursor=?,stats=?,status=?,finished_at=?,updated_at=? WHERE id=?`)
      .run(JSON.stringify(cursor),JSON.stringify({ ...(stats as any), ...(failure ? {failure} : {}) }),status,status==='completed'?now:null,now,id);
  }
  releaseLease(id:string, owner:string, now:string) { this.sqlite.prepare('UPDATE curation_runs SET lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?').run(now,id,owner); }
  acquireGlobalLease(owner:string,now:string,expiresAt:string):boolean {
    const id='__curation_global_lease__';this.sqlite.prepare(`INSERT OR IGNORE INTO curation_runs(id,started_at,trigger,model,budget,stats,status,cursor,updated_at) VALUES(?,?,'lease','', '{}','{}','running','{}',?)`).run(id,now,now);
    return this.sqlite.prepare("UPDATE curation_runs SET lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND status='running' AND (lease_owner IS NULL OR lease_expires_at<=? OR lease_owner=?)").run(owner,expiresAt,now,id,now,owner).changes===1;
  }
  releaseGlobalLease(owner:string,now:string){this.sqlite.prepare("UPDATE curation_runs SET lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id='__curation_global_lease__' AND lease_owner=?").run(now,owner);}
  renewGlobalLease(owner:string,now:string,expiresAt:string):boolean{return this.sqlite.prepare("UPDATE curation_runs SET lease_expires_at=?,updated_at=? WHERE id='__curation_global_lease__' AND lease_owner=?").run(expiresAt,now,owner).changes===1;}
  putVerdict(ids:[string,string], entries:any[], verdict:string, confidence:number, reason:string, model:string, now:string) {
    const ordered=[...entries].sort((a,b)=>a.id.localeCompare(b.id));
    this.sqlite.prepare(`INSERT OR REPLACE INTO curation_verdicts(id,entry_a_id,entry_b_id,entry_a_content_hash,entry_b_content_hash,entry_a_version,entry_b_version,verdict,confidence,reason,model,judged_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(`${ordered[0].id}:${ordered[1].id}:${ordered[0].contentHash}:${ordered[1].contentHash}:${ordered[0].version}:${ordered[1].version}`,ordered[0].id,ordered[1].id,ordered[0].contentHash??'',ordered[1].contentHash??'',ordered[0].version,ordered[1].version,verdict,confidence,reason,model,now);
  }
  findVerdict(a:any,b:any) {
    const [x,y]=[a,b].sort((u,v)=>u.id.localeCompare(v.id));
    return this.sqlite.prepare(`SELECT * FROM curation_verdicts WHERE entry_a_id=? AND entry_b_id=? AND entry_a_content_hash=? AND entry_b_content_hash=? AND entry_a_version=? AND entry_b_version=?`)
      .get(x.id,y.id,x.contentHash??'',y.contentHash??'',x.version,y.version) as any;
  }
  createAction(action:{id:string;runId?:string;kind:string;actor:string;entryIds:string[];snapshot:unknown;confidence?:number;payload:unknown;versions:Record<string,number|{version:number;contentHash:string|null;scope:string;status:string}>;key:string;now:string;undoExpiresAt?:string}) {
    const inserted=this.sqlite.prepare(`INSERT OR IGNORE INTO curation_actions(id,run_id,kind,actor,entry_ids,before_snapshot,after_snapshot,confidence,status,payload,expected_versions,idempotency_key,created_at,undo_expires_at,updated_at)
      VALUES(?,?,?,?,?,?,'{}',?,'proposed',?,?,?,?,?,?)`).run(action.id,action.runId??null,action.kind,action.actor,JSON.stringify(action.entryIds),JSON.stringify(action.snapshot),action.confidence??null,JSON.stringify(action.payload),JSON.stringify(action.versions),action.key,action.now,action.undoExpiresAt??null,action.now);
    return {...this.sqlite.prepare('SELECT * FROM curation_actions WHERE idempotency_key=?').get(action.key) as any,wasCreated:inserted.changes===1};
  }
  /** Pending proposals, oldest first, optionally limited to actions touching `scope` (keyset pagination). */
  listQueue(options:{scope?:string;limit:number;after?:[string,string]|null}) {
    const after=options.after??null;
    const rows=this.sqlite.prepare(`SELECT a.id,a.kind,a.actor,a.confidence,a.entry_ids,a.payload,a.created_at FROM curation_actions a
      WHERE a.status='proposed' AND (? IS NULL OR (a.created_at,a.id)>(?,?))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(a.expected_versions) v WHERE json_extract(v.value,'$.scope')=?))
      ORDER BY a.created_at,a.id LIMIT ?`).all(after?.[0]??null,after?.[0]??'',after?.[1]??'',options.scope??null,options.scope??null,options.limit+1) as any[];
    return rows;
  }
  /** Shallow-merge `patch` into the action payload (used to record who applied it and any override). */
  mergeActionPayload(id:string, patch:Record<string,unknown>) {
    const row=this.sqlite.prepare('SELECT payload FROM curation_actions WHERE id=?').get(id) as {payload:string}|undefined;
    if(!row)return;let current:any={};try{current=JSON.parse(row.payload)??{}}catch{}
    this.sqlite.prepare('UPDATE curation_actions SET payload=? WHERE id=?').run(JSON.stringify({...current,...patch}),id);
  }
  applyAction(id:string, now:string, mutation:(payload:any, snapshot:any)=>void):boolean {
    try { return this.transaction(()=>{
      const action=this.sqlite.prepare("SELECT * FROM curation_actions WHERE id=? AND status='proposed'").get(id) as any;
      if(!action)return false;
      const ids=JSON.parse(action.entry_ids) as string[], versions=JSON.parse(action.expected_versions) as Record<string,number|{version:number;contentHash:string|null;scope:string;status:string}>;
      const claims:any[]=[];
      for(const entryId of ids){ const row=this.sqlite.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(entryId) as any; let tags:string[]=[]; try{tags=JSON.parse(row?.tags??'[]');}catch{return false;}
        const allowedStatus=row?.status==='active'||(action.kind==='trash'&&row?.status==='superseded');
        const claim=versions[entryId],version=typeof claim==='number'?claim:claim?.version;
        if(!row||row.type==='system'||tags.includes('keep')||!allowedStatus||row.version!==version||claim&&typeof claim==='object'&&(row.content_hash!==claim.contentHash||row.scope!==claim.scope||row.status!==claim.status))return false;
        claims.push(row);
      }
      const scopes=new Set(claims.map(r=>r.scope).filter(s=>s!=='global'));if(scopes.size>1)return false;
      const before = JSON.parse(action.before_snapshot) as CurationSnapshotV1;
      if (!snapshotMatches(this.captureSnapshot(ids, Object.keys(before.incomingEntries ?? {})), before)) return false;
      if(this.sqlite.prepare("UPDATE curation_actions SET status='applied',applied_at=?,updated_at=? WHERE id=? AND status='proposed'").run(now,now,id).changes!==1)return false;
      mutation(JSON.parse(action.payload),before);
      const after=this.captureSnapshot(ids, Object.keys(before.incomingEntries ?? {}));
      for (const entryId of new Set([...Object.keys(before.incomingEntries ?? {}), ...Object.keys(after.incomingEntries ?? {})])) {
        const prior = before.incomingEntries?.[entryId], current = after.incomingEntries?.[entryId];
        if (!isDeepStrictEqual(prior, current) && (protectedEntry(prior) || protectedEntry(current))) {
          throw new CurationConflict('Curation cannot change protected incoming references');
        }
      }
      this.sqlite.prepare('UPDATE curation_actions SET after_snapshot=? WHERE id=?').run(JSON.stringify(after),id);
      return true;
    }); } catch (error) { if (error instanceof CurationConflict) return false; throw error; }
  }
  undoAction(id:string,now:string):boolean {
    return this.transaction(()=>{
      const a=this.sqlite.prepare("SELECT * FROM curation_actions WHERE id=? AND status='applied'").get(id) as any;
      if(!a||a.undo_expires_at&&Date.parse(a.undo_expires_at)<Date.parse(now))return false;
      const before=JSON.parse(a.before_snapshot) as CurationSnapshotV1, after=JSON.parse(a.after_snapshot) as CurationSnapshotV1;
      const ids=JSON.parse(a.entry_ids) as string[];
      const referrers=[...new Set([
        ...Object.keys(before.incomingEntries ?? {}), ...Object.keys(after.incomingEntries ?? {}),
        ...Object.values(before.incomingReferences ?? {}).flat(), ...Object.values(after.incomingReferences ?? {}).flat(),
      ])].filter(entryId => !ids.includes(entryId));
      if (before.version !== 1 || after.version !== 1 || ids.some(entryId => !before.entries[entryId] || !after.entries[entryId])) return false;
      if (!snapshotMatches(this.captureSnapshot(ids, referrers), after)) return false;
      const restore: Record<string, Record<string, unknown>> = {...before.entries};
      const restoreReferences = new Map<string, string[]>();
      for (const entryId of referrers) {
        const prior=before.incomingEntries?.[entryId], expected=after.incomingEntries?.[entryId];
        if (!isDeepStrictEqual(prior, expected) && prior) restore[entryId]=prior;
        if (!isDeepStrictEqual(prior, expected) && (protectedEntry(prior) || protectedEntry(this.getEntry(entryId)))) return false;
        if (!prior) {
          const current=this.getEntry(entryId);
          if (!current) return false;
          // Original v1 snapshots carry incoming memberships without referrer rows.
          const currentIds=JSON.parse(current.related_ids ?? '[]') as string[];
          const originalTargets=ids.filter(target => before.incomingReferences?.[target]?.includes(entryId));
          const relatedIds=currentIds.filter(target => !ids.includes(target) || originalTargets.includes(target));
          for (const target of originalTargets) if (!relatedIds.includes(target)) relatedIds.push(target);
          if (!isDeepStrictEqual(currentIds, relatedIds)) {
            if (protectedEntry(current)) return false;
            restoreReferences.set(entryId, relatedIds);
          }
        }
      }
      // Finish every guard before writing: returning false must never commit a partial restore.
      if (Object.entries(restore).some(([entryId,row]) => row.purged || !this.getEntry(entryId) || protectedEntry(row) || protectedEntry(this.getEntry(entryId)))) return false;
      for (const relation of before.planRelations) {
        if (relation.id === undefined) continue; // Legacy v1 snapshots omitted row IDs.
        const occupied = this.sqlite.prepare('SELECT knowledge_id AS knowledgeId FROM plan_relations WHERE id=?').get(relation.id) as {knowledgeId:string}|undefined;
        // Rows belonging to the action are removed below; unrelated rows must survive.
        if (occupied && !ids.includes(occupied.knowledgeId)) return false;
      }
      for(const [entryId,row] of Object.entries(restore)){
        const r=row as any;
        const columns=['title','content','content_hash','tags','type','scope','source','version','expires_at','confidence_score','related_ids','agent_id','platform','created_at','updated_at','last_read_at','read_count','status','superseded_by','curated_at','trashed_at'];
        const values=columns.map(c=>r[c]??null);this.sqlite.prepare(`UPDATE knowledge_entries SET ${columns.map(c=>`${c}=?`).join(',')} WHERE id=?`).run(...values,entryId);
        if (r.embedding) {
          this.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id=?').run(entryId);if(r.embedding.present&&r.embedding.bytesBase64){const bytes=Buffer.from(r.embedding.bytesBase64,'base64');this.sqlite.prepare('INSERT INTO knowledge_embeddings(id,embedding) VALUES(?,?)').run(entryId,bytes);}
        }
        this.sqlite.prepare('DELETE FROM knowledge_fts WHERE id=?').run(entryId);if(r.status==='active')this.sqlite.prepare('INSERT INTO knowledge_fts(id,title,content,tags) VALUES(?,?,?,?)').run(entryId,r.title,r.content,JSON.parse(r.tags??'[]').join(' '));
      }
      // Restore legacy memberships and remove links introduced by the action.
      for (const [entryId, relatedIds] of restoreReferences) {
        this.sqlite.prepare('UPDATE knowledge_entries SET related_ids=? WHERE id=?').run(JSON.stringify(relatedIds),entryId);
      }
      this.sqlite.prepare('DELETE FROM plan_relations WHERE knowledge_id IN (SELECT value FROM json_each(?))').run(JSON.stringify(JSON.parse(a.entry_ids)));
      // Explicit INTEGER PRIMARY KEY inserts preserve identity and let SQLite maintain
      // the AUTOINCREMENT high-water mark without rewinding IDs allocated meanwhile.
      for(const rel of before.planRelations)this.sqlite.prepare('INSERT INTO plan_relations(id,plan_id,knowledge_id,relation_type,created_at) VALUES(?,?,?,?,?)').run(rel.id??null,rel.planId,rel.knowledgeId,rel.relationType,rel.createdAt);
      this.sqlite.prepare("UPDATE curation_actions SET status='undone',updated_at=? WHERE id=?").run(now,id);return true;
    });
  }
  resolveFlag(id:string,now:string):boolean {
    return this.sqlite.prepare("UPDATE curation_actions SET status='applied',applied_at=?,updated_at=? WHERE id=? AND kind='flag' AND status='proposed'").run(now,now,id).changes===1;
  }
  reopenFlag(id:string,now:string):boolean {
    return this.sqlite.prepare("UPDATE curation_actions SET status='proposed',applied_at=NULL,updated_at=? WHERE id=? AND kind='flag' AND status='applied'").run(now,id).changes===1;
  }
  setActionStatus(id:string, from:string, to:string, now:string) { return this.sqlite.prepare('UPDATE curation_actions SET status=?,updated_at=? WHERE id=? AND status=?').run(to,now,id,from).changes===1; }
  getAction(id:string) { return this.sqlite.prepare('SELECT * FROM curation_actions WHERE id=?').get(id) as any; }
  claimAction(id:string, claims:{id:string;version:number;contentHash:string|null;status:string;scope?:string}[], apply:()=>void):boolean {
    return this.transaction(()=>{
      for(const claim of claims){
        const row=this.sqlite.prepare('SELECT version,content_hash AS contentHash,status,type,tags,scope FROM knowledge_entries WHERE id=?').get(claim.id) as any;
        if(!row||row.version!==claim.version||row.contentHash!==claim.contentHash||row.status!==claim.status||claim.scope!==undefined&&row.scope!==claim.scope||row.status!=='active'||row.type==='system') return false;
        let tags:string[]=[]; try{tags=JSON.parse(row.tags);}catch{return false;} if(tags.includes('keep')) return false;
      }
      const now=new Date().toISOString();
      if(this.sqlite.prepare("UPDATE curation_actions SET status='applied',applied_at=?,updated_at=? WHERE id=? AND status='proposed'").run(now,now,id).changes!==1)return false;
      apply(); return true;
    });
  }
}
class CurationConflict extends Error {}
function protectedEntry(row:any):boolean {
  if (!row) return false;
  try { return row.type === 'system' || JSON.parse(row.tags ?? '[]').includes('keep'); }
  catch { return true; }
}
function snapshotMatches(current:CurationSnapshotV1, expected:CurationSnapshotV1):boolean {
  const references = (refs:Record<string,string[]>) => Object.fromEntries(Object.entries(refs).map(([id,values]) => [id,[...values].sort()]));
  const relations = (rows:CurationSnapshotV1['planRelations']) => [...rows].sort((a,b) => a.knowledgeId.localeCompare(b.knowledgeId)||a.planId.localeCompare(b.planId)||a.relationType.localeCompare(b.relationType));
  const currentRelations = current.planRelations.map(row => {
    const prior = expected.planRelations.find(rel => rel.planId === row.planId && rel.knowledgeId === row.knowledgeId && rel.relationType === row.relationType);
    if (prior && prior.id === undefined) { const {id, ...legacy} = row; return legacy; }
    return row;
  });
  return expected.version === 1
    && isDeepStrictEqual(current.entries, expected.entries)
    && isDeepStrictEqual(current.outgoingRelatedIds, expected.outgoingRelatedIds)
    && isDeepStrictEqual(references(current.incomingReferences), references(expected.incomingReferences))
    && (expected.incomingEntries === undefined || isDeepStrictEqual(current.incomingEntries, expected.incomingEntries))
    && isDeepStrictEqual(relations(currentRelations), relations(expected.planRelations));
}
function bounded(n:number){return Math.max(1,Math.min(500,Math.floor(Number.isFinite(n)?n:100)));}
function boundedItems(n:number){return Math.max(1,Math.min(5000,Math.floor(Number.isFinite(n)?n:500)));}
function page(db:Database.Database,table:string,after:{updatedAt:string;id:string}|null,limit:number){return db.prepare(`SELECT * FROM ${table} WHERE (? IS NULL OR (updated_at,id)>(?,?)) ORDER BY updated_at,id LIMIT ?`).all(after?.updatedAt??null,after?.updatedAt??'',after?.id??'',bounded(limit));}
