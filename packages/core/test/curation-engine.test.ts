import { afterEach, describe, expect, it } from 'vitest';
import { makeDb } from './helpers.js';
import { CurationEngine, CurationRepository, type CurationOptions, type CurationJudge, type JudgeInput, type JudgeResult } from '../src/index.js';

let ctx:ReturnType<typeof makeDb>|undefined;
afterEach(()=>{ctx?.cleanup();ctx=undefined;});
const opts=(autonomy:CurationOptions['autonomy']='suggest'):CurationOptions=>({autonomy,budgetMs:900000,maxClusters:50,maxItems:500,trashRetentionDays:30,clusterThreshold:.85,deprecatedUnreadDays:180,model:'test',trigger:'test'});
const judge=(fn:(input:JudgeInput)=>JudgeResult|null):CurationJudge=>({async judge(input){return fn(input)}});
async function add(title:string,content:string,scope='workspace:a',embedding=[1,...Array(255).fill(0)]){return ctx!.repository.create({title,content,tags:[],type:'pattern',scope,source:'test',embedding});}
function engine(j?:CurationJudge){return new CurationEngine(new CurationRepository(ctx!.sqlite),j);}

describe('CurationEngine',()=>{
  it('suggest queues deterministic and LLM actions without changing entries',async()=>{
    ctx=makeDb();await add('Same','same');await add('Same','same');
    const before=ctx.sqlite.prepare('SELECT id,status,version FROM knowledge_entries ORDER BY id').all();
    const result=await engine(judge(input=>({verdict:'duplicate',confidence:.99,reason:'overlap',candidateIds:input.candidateIds}))).run(opts());
    expect(result.proposed).toBeGreaterThan(0);expect(ctx.sqlite.prepare('SELECT id,status,version FROM knowledge_entries ORDER BY id').all()).toEqual(before);
    expect(result).toMatchObject({status:'completed',failures:[],applied:0});
    expect(ctx.sqlite.prepare('SELECT kind,status FROM curation_actions ORDER BY kind').all()).toEqual([{kind:'duplicate',status:'proposed'},{kind:'merge',status:'proposed'}]);
  });
  it('off skips pipeline and purge',async()=>{ctx=makeDb();const e=await add('Old','content');ctx.sqlite.prepare("UPDATE knowledge_entries SET status='trashed',trashed_at='2000-01-01' WHERE id=?").run(e.id);
    expect(await engine().run(opts('off'))).toMatchObject({proposed:0,applied:0});expect(engine().purge({autonomy:'off',retentionDays:1})).toEqual({purged:0});expect(ctx.sqlite.prepare('SELECT 1 FROM knowledge_entries WHERE id=?').get(e.id)).toBeTruthy();
  });
  it('autonomy matrix enforces confidence thresholds',async()=>{
    for(const [mode,confidence,status] of [['suggest',.99,'proposed'],['auto-safe',.84,'proposed'],['auto-safe',.85,'applied'],['auto',.69,'proposed'],['auto',.70,'applied']] as const){ctx=makeDb();const a=await add('A','unique a'),b=await add('B','unique b');
      const result=await engine(judge(input=>{expect(input.hashes).toEqual(Object.fromEntries(input.entries.map(entry=>[entry.id,entry.contentHash])));return {verdict:'duplicate',confidence,reason:'similar',candidateIds:[a.id,b.id]}})).run(opts(mode));
      expect(result).toMatchObject({status:'completed',failures:[]});
      expect(ctx.sqlite.prepare("SELECT status FROM curation_actions WHERE kind='merge'").get()).toEqual({status});
      expect(new CurationRepository(ctx.sqlite).listActions(null,100,result.runId)).toEqual(expect.arrayContaining([expect.objectContaining({kind:'merge',status})]));ctx.cleanup();ctx=undefined;
    }
  });
  it('clusters respect workspace boundaries global inclusion and eight-member cap',async()=>{
    ctx=makeDb();for(let i=0;i<10;i++)await add(`A${i}`,`content ${i}`,'workspace:a');await add('Global','global','global');await add('Other','other','workspace:b');
    const seen:string[][]=[];await engine(judge(input=>{seen.push(input.candidateIds);return {verdict:'distinct',confidence:.9,reason:'different',candidateIds:input.candidateIds}})).run(opts());
    expect(seen.every(x=>x.length<=8)).toBe(true);expect(seen.flat()).toContain((await ctx.repository.findById((ctx.sqlite.prepare("SELECT id FROM knowledge_entries WHERE title='Global'").get() as any).id))!.id);
    expect(seen.every(group=>new Set(group.map(id=>(ctx!.sqlite.prepare('SELECT scope FROM knowledge_entries WHERE id=?').get(id) as any).scope).filter((scope:string)=>scope!=='global')).size<=1)).toBe(true);
  });
  it('distinct cache invalidates when either hash or version changes',()=>{ctx=makeDb();const r=new CurationRepository(ctx.sqlite),a={id:'a',contentHash:'ha',version:1},b={id:'b',contentHash:'hb',version:1};
    r.putVerdict(['a','b'],[a,b],'distinct',.9,'distinct','m',new Date().toISOString());expect(r.findVerdict(a,b)).toBeTruthy();expect(r.findVerdict({...a,version:2},b)).toBeUndefined();expect(r.findVerdict(a,{...b,contentHash:'changed'})).toBeUndefined();
  });
  it('aging and restructuring produce bounded eligible proposals',async()=>{ctx=makeDb();const a=await add('Untitled','old knowledge');ctx.sqlite.prepare("UPDATE knowledge_entries SET created_at='2000-01-01',last_read_at='2000-01-01',confidence_score=0 WHERE id=?").run(a.id);
    await engine(judge(input=>input.taskKind==='aging'?{verdict:'outdated',confidence:.8,reason:'stale',candidateIds:input.candidateIds}:{verdict:'proposal',confidence:.8,reason:'descriptive title',candidateIds:input.candidateIds,payload:{title:'Old knowledge'}})).run(opts());
    expect(ctx.sqlite.prepare('SELECT count(*) AS n FROM curation_actions WHERE status=\'proposed\'').get()).toMatchObject({n:expect.any(Number)});expect((ctx.sqlite.prepare('SELECT count(*) AS n FROM curation_actions').get() as any).n).toBeLessThanOrEqual(2);
  });
  it('budget and cancellation resume every phase without duplicate actions',async()=>{ctx=makeDb();await add('A','a');const controller=new AbortController();let aborted=false;
    const first=await engine().run(opts(),controller.signal,async()=>{if(!aborted){aborted=true;controller.abort();}});expect(first.status).toBe('paused');const count=(ctx.sqlite.prepare('SELECT count(*) AS n FROM curation_actions').get() as any).n;
    const second=await engine().resume(first.runId,opts());expect(second.status).toBe('completed');expect((ctx.sqlite.prepare('SELECT count(*) AS n FROM curation_actions').get() as any).n).toBe(count);
  });
  it('expired lease resumes an interrupted run',async()=>{ctx=makeDb();const r=new CurationRepository(ctx.sqlite),now=new Date().toISOString();r.createRun('interrupted',opts(),'2000-01-01');ctx.sqlite.prepare("UPDATE curation_runs SET lease_owner='dead',lease_expires_at='2000-01-01' WHERE id='interrupted'").run();
    expect((await engine().resume('interrupted',opts())).status).toBe('completed');
  });
});


describe('auto curation security gates',()=>{
  it('auto never applies LLM-only low-confidence aging verdicts',async()=>{
    ctx=makeDb();const old=await add('Old','old knowledge'),recent=await add('Recent','recent knowledge','workspace:b');
    ctx.sqlite.prepare("UPDATE knowledge_entries SET created_at='2000-01-01',updated_at='2000-01-01',last_read_at='2000-01-01',confidence_score=0 WHERE id=?").run(old.id);
    const seen:string[]=[];
    const result=await engine(judge(input=>{
      if(input.taskKind!=='aging')return null;
      seen.push(...input.candidateIds);
      return {verdict:'outdated',confidence:.84,reason:'injected aging claim',candidateIds:input.candidateIds};
    })).run(opts('auto'));
    expect(result).toMatchObject({status:'completed',failures:[],applied:0,proposed:1});
    expect(seen).toEqual([old.id]);
    expect(new CurationRepository(ctx.sqlite).getEntry(old.id).status).toBe('active');
    expect(new CurationRepository(ctx.sqlite).getEntry(recent.id).status).toBe('active');
    expect(ctx.sqlite.prepare("SELECT status FROM curation_actions WHERE kind='aging'").get()).toEqual({status:'proposed'});
  });

  it('auto applies aging only with deterministic score and confidence >= 0.85',async()=>{
    for(const confidence of [.84,.85,1]){
      ctx=makeDb();const old=await add('Old','old knowledge');
      ctx.sqlite.prepare("UPDATE knowledge_entries SET created_at='2000-01-01',updated_at='2000-01-01',last_read_at='2000-01-01',confidence_score=0 WHERE id=?").run(old.id);
      const result=await engine(judge(input=>input.taskKind==='aging'?{verdict:'outdated',confidence,reason:'stale',candidateIds:input.candidateIds}:null)).run(opts('auto'));
      const action=ctx.sqlite.prepare("SELECT status,payload FROM curation_actions WHERE kind='aging'").get() as any;
      expect(result).toMatchObject({status:'completed',failures:[],applied:confidence>=.85?1:0});
      expect(JSON.parse(action.payload).score).toBeGreaterThanOrEqual(.70);
      expect(action.status).toBe(confidence>=.85?'applied':'proposed');
      expect(new CurationRepository(ctx.sqlite).getEntry(old.id).status).toBe(confidence>=.85?'trashed':'active');
      ctx.cleanup();ctx=undefined;
    }
  });

  it('auto restructuring and complementary below 0.85 stay proposed',async()=>{
    for(const [mode,confidence,status] of [['auto',.84,'proposed'],['auto',.85,'applied'],['auto-safe',1,'proposed'],['suggest',1,'proposed']] as const){
      ctx=makeDb();const a=await add('Specific','specific knowledge'),b=await add('Other','other knowledge');
      const titleEntry=await add('Untitled','descriptive knowledge','workspace:title');
      ctx.sqlite.prepare("UPDATE knowledge_entries SET related_ids='[]' WHERE id IN (?,?)").run(a.id,b.id);
      const result=await engine(judge(input=>input.taskKind==='cluster'?{verdict:'complementary',confidence,reason:'related',candidateIds:input.candidateIds}:input.taskKind==='title'?{verdict:'proposal',confidence,reason:'descriptive',candidateIds:input.candidateIds,payload:{title:'Descriptive knowledge'}}:null)).run(opts(mode));
      const repo=new CurationRepository(ctx.sqlite);
      expect(result).toMatchObject({status:'completed',failures:[]});
      expect(ctx.sqlite.prepare("SELECT kind,status FROM curation_actions ORDER BY kind").all()).toEqual([{kind:'complementary',status},{kind:'title',status}]);
      expect(repo.getEntry(titleEntry.id).title).toBe(status==='applied'?'Descriptive knowledge':'Untitled');
      expect(JSON.parse(repo.getEntry(a.id).related_ids)).toEqual(status==='applied'?[b.id]:[]);
      ctx.cleanup();ctx=undefined;
    }
  });

  it('auto keeps deterministic synonym rewrites applying',async()=>{
    ctx=makeDb();const a=await ctx.repository.create({title:'Specific title',content:'knowledge',tags:['typescript'],type:'pattern',scope:'global',source:'test',embedding:[1,...Array(255).fill(0)]});
    const result=await engine().run(opts('auto'));
    expect(result).toMatchObject({status:'completed',failures:[],applied:1});
    expect(JSON.parse(new CurationRepository(ctx.sqlite).getEntry(a.id).tags)).toEqual(['ts']);
  });

  it('auto merge and supersede recheck similarity at apply time',async()=>{
    for(const verdict of ['duplicate','supersedes'] as const){
      ctx=makeDb();const a=await add('A','alpha'),b=await add('B','beta');
      const repo=new CurationRepository(ctx.sqlite),create=repo.createAction.bind(repo);
      repo.createAction=(input)=>{
        const created=create(input);
        if(input.kind==='merge'||input.kind==='supersedes')ctx!.sqlite.prepare('UPDATE knowledge_embeddings SET embedding=? WHERE id=?').run(Buffer.from(new Float32Array([0,1,...Array(254).fill(0)]).buffer),b.id);
        return created;
      };
      const result=await new CurationEngine(repo,judge(input=>input.taskKind==='cluster'?{verdict,confidence:1,reason:'similar',candidateIds:input.candidateIds,payload:verdict==='supersedes'?{sourceId:a.id,targetId:b.id}:undefined}:null)).run(opts('auto'));
      expect(result).toMatchObject({status:'completed',failures:[],applied:0,proposed:1});
      expect(repo.getEntry(a.id).status).toBe('active');expect(repo.getEntry(b.id).status).toBe('active');
      expect(repo.listActions(null,100,result.runId)[0]).toMatchObject({status:'proposed'});
      ctx.cleanup();ctx=undefined;
    }
  });

  it('auto supersede requires 0.70 confidence and rejects verdict ids outside submitted candidates',async()=>{
    for(const [confidence,outside,status] of [[.69,false,'proposed'],[.70,false,'applied'],[1,true,undefined]] as const){
      ctx=makeDb();const a=await add('A','alpha'),b=await add('B','beta'),c=await add('Outside','outside','workspace:b');
      const result=await engine(judge(input=>input.taskKind==='cluster'?{verdict:'supersedes',confidence,reason:'updated',candidateIds:outside?[a.id,c.id]:input.candidateIds,payload:{sourceId:a.id,targetId:outside?c.id:b.id}}:null)).run(opts('auto'));
      expect(result).toMatchObject({status:'completed',failures:[]});
      expect(ctx.sqlite.prepare("SELECT status FROM curation_actions WHERE kind='supersedes'").get()).toEqual(status?{status}:undefined);
      expect(new CurationRepository(ctx.sqlite).getEntry(c.id).status).toBe('active');
      ctx.cleanup();ctx=undefined;
    }
  });
});
