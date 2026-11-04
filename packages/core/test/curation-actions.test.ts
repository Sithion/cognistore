import { afterEach, describe, expect, it } from 'vitest';
import { makeDb } from './helpers.js';
import { CurationEngine, CurationRepository } from '../src/index.js';

let ctx:ReturnType<typeof makeDb>|undefined;afterEach(()=>{ctx?.cleanup();ctx=undefined;});
async function add(title:string,content:string,tags:string[]=[],relatedIds?:string[]){return ctx!.repository.create({title,content,tags,type:'pattern',scope:'global',source:'test',relatedIds,embedding:[1,...Array(255).fill(0)]});}
function action(repo:CurationRepository,ids:string[],kind='merge',payload:any={}){const now=new Date().toISOString();return repo.createAction({id:crypto.randomUUID(),kind,actor:'test',entryIds:ids,snapshot:repo.captureSnapshot(ids),payload,versions:Object.fromEntries(ids.map(id=>{const e=repo.getEntry(id);return[id,{version:e.version,contentHash:e.content_hash,scope:e.scope,status:e.status}]})),key:`test:${kind}:${ids.join(':')}`,now,undoExpiresAt:new Date(Date.now()+86400000).toISOString()});}

describe('curation actions',()=>{
  it('merge undo restores entries vectors tags and relations atomically',async()=>{
    ctx=makeDb();const a=await add('A','alpha',['x']),b=await add('B','beta',['y'],[a.id]);ctx.repository.addPlanRelation(ctx.repository.createPlan({title:'P',content:'p',tags:[],scope:'global',source:'test',embedding:Array(256).fill(0)}).id,a.id,'input');
    const ref=await add('Existing reference','ref',[],[b.id,a.id]),newRef=await add('New reference','new ref',[],[]);
    const repo=new CurationRepository(ctx.sqlite),a0=repo.readVector(a.id),b0=repo.readVector(b.id),before=repo.captureSnapshot([a.id,b.id]),act=action(repo,[a.id,b.id]);
    const addedPlan=ctx.repository.createPlan({title:'Added plan',content:'added',tags:[],scope:'global',source:'test',embedding:Array(256).fill(0)});
    expect(repo.applyAction(act.id,new Date().toISOString(),()=>{
      repo.mutateEntry(a.id,{title:'Merged',content:'alpha beta',tags:['x','y'],relatedIds:[ref.id]},new Date().toISOString());
      repo.mutateEntry(b.id,{status:'superseded',supersededBy:a.id,tags:[]},new Date().toISOString());
      repo.mutateEntry(ref.id,{relatedIds:[a.id]},new Date().toISOString());
      ctx!.sqlite.prepare('UPDATE knowledge_entries SET related_ids=? WHERE id=?').run(JSON.stringify([a.id]),newRef.id);
      ctx!.repository.addPlanRelation(addedPlan.id,b.id,'output');
      ctx!.sqlite.prepare('DELETE FROM knowledge_embeddings WHERE id=?').run(b.id);
    })).toBe(true);
    expect(repo.undoAction(act.id,new Date().toISOString())).toBe(true);expect(repo.getEntry(a.id).title).toBe('A');expect(repo.getEntry(b.id).status).toBe('active');expect(repo.getEntry(b.id).tags).toBe('["y"]');expect(repo.readVector(a.id)).toEqual(a0);expect(repo.readVector(b.id)).toEqual(b0);expect(repo.getEntry(b.id).related_ids).toBe(JSON.stringify([a.id]));
    expect(repo.captureSnapshot([a.id,b.id])).toEqual(before);
    expect(repo.getEntry(newRef.id).related_ids).toBe('[]');
    expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM plan_relations WHERE knowledge_id=?').get(b.id)).toEqual({n:0});
    expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM plan_relations WHERE knowledge_id=?').get(a.id)).toEqual({n:1});
  });
  it('stale apply and undo reject without partial writes',async()=>{
    ctx=makeDb();const a=await add('A','alpha'),b=await add('B','beta');const repo=new CurationRepository(ctx.sqlite),act=action(repo,[a.id,b.id]);repo.mutateEntry(b.id,{title:'changed'},new Date().toISOString());
    expect(repo.applyAction(act.id,new Date().toISOString(),()=>repo.mutateEntry(a.id,{title:'partial'},new Date().toISOString()))).toBe(false);expect(repo.getEntry(a.id).title).toBe('A');
    const fresh=action(repo,[a.id]);expect(repo.applyAction(fresh.id,new Date().toISOString(),()=>repo.mutateEntry(a.id,{title:'after'},new Date().toISOString()))).toBe(true);repo.mutateEntry(a.id,{content:'later'},new Date().toISOString());expect(repo.undoAction(fresh.id,new Date().toISOString())).toBe(false);expect(repo.getEntry(a.id).content).toBe('later');
    const ref=await add('Ref','ref',[],[a.id]);
    const relationAction=action(repo,[a.id],'complementary');
    expect(repo.applyAction(relationAction.id,new Date().toISOString(),()=>repo.mutateEntry(a.id,{relatedIds:[b.id]},new Date().toISOString()))).toBe(true);
    repo.mutateEntry(ref.id,{relatedIds:[a.id,b.id]},new Date().toISOString());
    const beforeRejectedUndo=repo.captureSnapshot([a.id]);
    expect(repo.undoAction(relationAction.id,new Date().toISOString())).toBe(false);
    expect(repo.captureSnapshot([a.id])).toEqual(beforeRejectedUndo);
  });
  it('keep and system survive every direct and indirect curation operation',async()=>{
    ctx=makeDb();const kept=await ctx.repository.create({title:'Keep',content:'k',tags:['keep'],type:'pattern',scope:'global',source:'test',embedding:Array(256).fill(0)});const ordinary=await add('A','a');const sys=await ctx.repository.create({title:'System',content:'s',tags:[],type:'system',scope:'global',source:'test',embedding:Array(256).fill(0)});
    const repo=new CurationRepository(ctx.sqlite),act=action(repo,[ordinary.id,kept.id],'trash');expect(repo.applyAction(act.id,new Date().toISOString(),()=>repo.mutateEntry(ordinary.id,{status:'trashed'},new Date().toISOString()))).toBe(false);expect(repo.getEntry(ordinary.id).status).toBe('active');
    const indirect=action(repo,[sys.id],'trash');expect(repo.applyAction(indirect.id,new Date().toISOString(),()=>repo.mutateEntry(sys.id,{status:'trashed'},new Date().toISOString()))).toBe(false);expect(repo.getEntry(sys.id).status).toBe('active');expect(repo.purgeEntry(kept.id)).toBeUndefined();expect(repo.getEntry(kept.id)).toBeTruthy();
    for (const protectedId of [kept.id,sys.id]) {
      const before=repo.getEntry(protectedId);
      for (const kind of ['merge','supersedes','complementary','tags','title','trash']) {
        const protectedAction=action(repo,[ordinary.id,protectedId],kind);
        expect(repo.applyAction(protectedAction.id,new Date().toISOString(),()=>repo.mutateEntry(ordinary.id,{title:'partial'},new Date().toISOString()))).toBe(false);
      }
      expect(()=>repo.mutateEntry(protectedId,{tags:['rewritten']},new Date().toISOString())).toThrow('Protected');
      expect(repo.getEntry(protectedId)).toEqual(before);
    }
    expect(repo.getEntry(ordinary.id).title).toBe('A');
    // Incoming references on protected rows cannot be rewritten, even indirectly.
    ctx.sqlite.prepare('UPDATE knowledge_entries SET related_ids=? WHERE id=?').run(JSON.stringify([ordinary.id]),kept.id);
    const before=repo.captureSnapshot([ordinary.id]);
    const relationAction=action(repo,[ordinary.id],'complementary');
    expect(repo.applyAction(relationAction.id,new Date().toISOString(),()=>{
      repo.mutateEntry(ordinary.id,{title:'partial'},new Date().toISOString());
      ctx!.sqlite.prepare("UPDATE knowledge_entries SET related_ids='[]' WHERE id=?").run(kept.id);
    })).toBe(false);
    expect(repo.captureSnapshot([ordinary.id])).toEqual(before);
    expect(repo.getAction(relationAction.id).status).toBe('proposed');
    ctx.sqlite.prepare("UPDATE knowledge_entries SET status='trashed',trashed_at='2000-01-01' WHERE id=?").run(ordinary.id);
    expect(repo.purgeEntry(ordinary.id,'2001-01-01')).toBeUndefined();
    expect(repo.getEntry(ordinary.id)).toBeTruthy();
    expect(repo.getEntry(kept.id).related_ids).toBe(JSON.stringify([ordinary.id]));
  });
  it('trash purge respects retention and removes dependencies and snapshot payloads',async()=>{
    ctx=makeDb();const a=await add('Expired payload','secret content'),b=await add('Ref','ref',[],[a.id]);ctx.sqlite.prepare("UPDATE knowledge_entries SET status='trashed',trashed_at='2000-01-01' WHERE id=?").run(a.id);
    const repo=new CurationRepository(ctx.sqlite),act=action(repo,[a.id],'trash');expect(new CurationEngine(repo).purge({autonomy:'suggest',retentionDays:30,batchSize:10}).purged).toBe(1);
    expect(repo.getEntry(a.id)).toBeUndefined();expect(repo.readVector(a.id)).toBeNull();expect(JSON.parse(repo.getEntry(b.id).related_ids)).toEqual([]);const stored=repo.getAction(act.id);expect(stored.before_snapshot).not.toContain('secret content');expect(stored.before_snapshot).not.toContain('bytesBase64');
  });
  it('legacy removal creates one trash proposal and deletes nothing',async()=>{
    ctx=makeDb();const e=await ctx.service.add({title:'Deprecated',content:'retain me',tags:['deprecated'],type:'pattern',scope:'global',source:'test',skipDedup:true} as any);const {report}=await ctx.service.generateCleanupReport({});const [candidate]=ctx.repository.listCleanupCandidates(report.id);
    const result=await ctx.service.applyRemovalCandidate(candidate.id);expect(result.deleted).toBe(1);expect(result.deletedSnapshot[0].content).toBe('retain me');expect(ctx.sqlite.prepare('SELECT status FROM knowledge_entries WHERE id=?').get(e.id)).toEqual({status:'trashed'});expect(ctx.sqlite.prepare("SELECT count(*) AS n FROM curation_actions WHERE kind='trash' AND status='applied' AND entry_ids LIKE ?").get(`%${e.id}%`)).toEqual({n:1});expect(ctx.sqlite.prepare('SELECT 1 FROM knowledge_entries WHERE id=?').get(e.id)).toBeTruthy();
  });
});
