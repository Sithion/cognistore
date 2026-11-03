import type Database from 'better-sqlite3';

export interface CurationSnapshotV1 {
  version: 1;
  entries: Record<string, Record<string, unknown> & { embedding: { present: boolean; bytesBase64?: string; dimensions?: number } }>;
  outgoingRelatedIds: Record<string, string[]>;
  incomingReferences: Record<string, string[]>;
  planRelations: { planId: string; knowledgeId: string; relationType: string; createdAt: string }[];
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
  captureSnapshot(ids: string[]): CurationSnapshotV1 {
    const entries: CurationSnapshotV1['entries'] = {}, outgoingRelatedIds: Record<string,string[]> = {}, incomingReferences: Record<string,string[]> = {};
    const planRelations: CurationSnapshotV1['planRelations'] = [], unique = [...new Set(ids)];
    for (let offset=0; offset<unique.length; offset+=100) {
      const batch=unique.slice(offset,offset+100), marks=batch.map(()=>'?').join(',');
      const rows=this.sqlite.prepare(`SELECT * FROM knowledge_entries WHERE id IN (${marks})`).all(...batch) as Record<string,any>[];
      const getVector=this.sqlite.prepare('SELECT embedding FROM knowledge_embeddings WHERE id = ?');
      for (const row of rows) {
        const vector=getVector.get(row.id) as {embedding:Buffer}|undefined;
        entries[row.id]={...row,embedding:vector?{present:true,bytesBase64:vector.embedding.toString('base64'),dimensions:vector.embedding.byteLength/4}:{present:false}};
        try { outgoingRelatedIds[row.id]=JSON.parse(row.related_ids??'[]'); } catch { outgoingRelatedIds[row.id]=[]; }
      }
      const placeholders=batch.map(()=>'?').join(',');
      const refs=this.sqlite.prepare(`SELECT id FROM knowledge_entries WHERE ${batch.map(()=>"EXISTS (SELECT 1 FROM json_each(knowledge_entries.related_ids) WHERE value = ?)").join(' OR ')}`).all(...batch) as {id:string}[];
      for (const id of batch) incomingReferences[id]=refs.filter(ref=>Boolean(this.sqlite.prepare('SELECT 1 FROM knowledge_entries WHERE id=? AND EXISTS (SELECT 1 FROM json_each(related_ids) WHERE value=?)').get(ref.id,id))).map(ref=>ref.id);
      planRelations.push(...this.sqlite.prepare(`SELECT plan_id AS planId, knowledge_id AS knowledgeId, relation_type AS relationType, created_at AS createdAt FROM plan_relations WHERE knowledge_id IN (${marks})`).all(...batch) as CurationSnapshotV1['planRelations']);
    }
    return {version:1,entries,outgoingRelatedIds,incomingReferences,planRelations};
  }
  transaction<T>(fn:()=>T):T { return this.sqlite.transaction(fn).immediate(); }
  claimAction(id:string, claims:{id:string;version:number;contentHash:string|null;status:string}[], apply:()=>void):boolean {
    return this.transaction(()=>{
      for(const claim of claims){
        const row=this.sqlite.prepare('SELECT version,content_hash AS contentHash,status,type,tags FROM knowledge_entries WHERE id=?').get(claim.id) as any;
        if(!row||row.version!==claim.version||row.contentHash!==claim.contentHash||row.status!==claim.status||row.status!=='active'||row.type==='system') return false;
        let tags:string[]=[]; try{tags=JSON.parse(row.tags);}catch{return false;} if(tags.includes('keep')) return false;
      }
      const now=new Date().toISOString();
      if(this.sqlite.prepare("UPDATE curation_actions SET status='applied',applied_at=?,updated_at=? WHERE id=? AND status='proposed'").run(now,now,id).changes!==1)return false;
      apply(); return true;
    });
  }
}
function bounded(n:number){return Math.max(1,Math.min(500,Math.floor(Number.isFinite(n)?n:100)));}
function page(db:Database.Database,table:string,after:{updatedAt:string;id:string}|null,limit:number){return db.prepare(`SELECT * FROM ${table} WHERE (? IS NULL OR (updated_at,id)>(?,?)) ORDER BY updated_at,id LIMIT ?`).all(after?.updatedAt??null,after?.updatedAt??'',after?.id??'',bounded(limit));}
