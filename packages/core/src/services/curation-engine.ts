import { randomUUID } from 'node:crypto';
import type { CurationRepository } from '../repositories/curation.repository.js';
import { computeMergedTags, deterministicMergeDraft, validateMergeDraft, type MergeMember } from './cleanup-merge.js';
import { contentHash } from '../jobs/content-hash.js';
import type { CurationJudge, CurationOptions, CurationRunResult, JudgeEntryData, JudgeInput, JudgeResult } from './curation-types.js';

const DAY=86_400_000;
type Entry=any;
export class CurationEngine {
  constructor(private repository:CurationRepository, private judge?:CurationJudge, private owner=randomUUID()) {}

  private async requestJudge(input:JudgeInput,signal?:AbortSignal):Promise<JudgeResult|null>{
    if(!this.judge||signal?.aborted)return null;
    try {
      const result=await this.judge.judge(input,signal);
      if(!result||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1||!result.reason?.trim()||!Array.isArray(result.candidateIds)||!result.candidateIds.length||result.candidateIds.some(id=>!input.candidateIds.includes(id)))return null;
      const allowed:Record<JudgeInput['taskKind'],string[]>={cluster:['duplicate','supersedes','complementary','distinct'],aging:['still_valid','outdated','unsure'],tags:['proposal'],title:['proposal']};
      if(!allowed[input.taskKind].includes(result.verdict))return null;
      if(input.taskKind==='cluster'&&result.verdict==='supersedes'&&(!result.payload?.sourceId||!result.payload.targetId||result.payload.sourceId===result.payload.targetId||!input.candidateIds.includes(result.payload.sourceId)||!input.candidateIds.includes(result.payload.targetId)))return null;
      if(input.taskKind==='title'&&(typeof result.payload?.title!=='string'||!result.payload.title.trim()||result.payload.title.length>500))return null;
      if(input.taskKind==='tags'&&(!Array.isArray(result.payload?.tags)||result.payload.tags.length>20||result.payload.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>50)))return null;
      return result;
    } catch { return null; }
  }

  async run(options:CurationOptions, signal?:AbortSignal, checkpoint?:(state:{phase:string;done:number;total:number;cursor:string})=>Promise<void>):Promise<CurationRunResult> {
    if(options.autonomy==='off') return {runId:options.runId??'',status:'completed',proposed:0,applied:0,processed:0,failures:[]};
    const started=Date.now(), now=new Date().toISOString(), runId=options.runId??randomUUID();
    const run=this.repository.createRun(runId,options,now);
    if(run.status==='completed') return {runId,status:'completed',proposed:0,applied:0,processed:0,failures:[]};
    if(!this.repository.acquireLease(runId,this.owner,now,new Date(Date.now()+60_000).toISOString())) throw new Error('Curation run is leased by another worker');
    if(!this.repository.acquireGlobalLease(this.owner,now,new Date(Date.now()+60_000).toISOString())){this.repository.releaseLease(runId,this.owner,now);throw new Error('Another curation pipeline holds the database lease');}
    let proposed=0,applied=0,processed=0; const failures:{phase:string;error:string}[]=[];
    let leaseLost=false;const heartbeat=setInterval(()=>{const tick=new Date().toISOString(),until=new Date(Date.now()+60_000).toISOString();if(!this.repository.acquireLease(runId,this.owner,tick,until)||!this.repository.renewGlobalLease(this.owner,tick,until))leaseLost=true;},20_000);heartbeat.unref?.();
    const cursor=parse(run.cursor);
    try {
      const entries=this.repository.listEligibleEntries(options.maxItems) as Entry[];
      const superseded=entries.length<options.maxItems?this.repository.listSupersededEntries(options.maxItems-entries.length) as Entry[]:[];
      const assertCurrent=()=>{if(leaseLost)throw Object.assign(new Error('Curation database lease was lost'),{code:'CURATION_LEASE_LOST'});if(signal?.aborted||Date.now()-started>=options.budgetMs)throw Object.assign(new Error(signal?.aborted?'Cancelled':'Curation budget exhausted'),{code:signal?.aborted?'ABORT_ERR':'CURATION_BUDGET'});};
      const checkpointPhase=async(phase:string,index:number,total:number)=>{
        assertCurrent();
        const heartbeat=new Date().toISOString(), leaseUntil=new Date(Date.now()+60_000).toISOString();
        if(!this.repository.acquireLease(runId,this.owner,heartbeat,leaseUntil)||!this.repository.renewGlobalLease(this.owner,heartbeat,leaseUntil))throw new Error('Curation database lease was lost');
        this.repository.checkpointRun(runId,{...cursor,phase,index},{proposed,applied,processed,failures},'running',new Date().toISOString());
        await checkpoint?.({phase,done:index,total,cursor:`${phase}:${index}`});
      };
      const action= (kind:string, ids:string[], payload:unknown, confidence:number|undefined, phase:string) => {
        const current=ids.map((id)=>this.repository.getEntry(id)).filter(Boolean) as Entry[];
        if(current.length!==ids.length||current.some(e=>!(eligible(e)||(kind==='trash'&&e.status==='superseded'&&e.type!=='system'&&!parse(e.tags).includes('keep'))))) return;
        const versions=Object.fromEntries(current.map(e=>[e.id,{version:e.version,contentHash:e.content_hash,scope:e.scope,status:e.status}]));
        const key=`${runId}:${phase}:${kind}:${ids.slice().sort().join(',')}:${JSON.stringify(payload)}`;
        const deterministic=phase==='deterministic';
        const threshold=options.autonomy==='suggest'?Infinity:deterministic?0:kind==='merge'||kind==='supersedes'? (options.autonomy==='auto'?0.70:0.85):options.autonomy==='auto'?0.85:Infinity;
        const nowAction=new Date().toISOString(), confidenceValue=confidence??(kind==='trash'||kind==='expire'||kind==='duplicate'||kind==='deprecated'?1:0);
        this.repository.transaction(()=>{
          const created=this.repository.createAction({id:randomUUID(),runId,kind,actor:'curation',entryIds:ids,snapshot:this.repository.captureSnapshot(ids),confidence,payload,versions,key,now:nowAction,undoExpiresAt:new Date(Date.now()+options.trashRetentionDays*DAY).toISOString()});
          if(created.wasCreated&&created.status==='proposed') proposed++;
          if(confidenceValue>=threshold){const ok=applyValidatedAction(this.repository,created.id,kind,ids,nowAction,options.autonomy==='auto');if(ok){applied++;proposed=Math.max(0,proposed-1);}}
          this.repository.checkpointRun(runId,{...cursor,lastActionKey:key},{proposed,applied,processed,failures},'running',nowAction);
        });
      };
      if(!cursor.deterministicDone){
        const groups=new Map<string,Entry[]>(); for(const e of entries){const key=`${e.scope}:${e.contentHash??contentHash(e.title,e.content)}`;groups.set(key,[...(groups.get(key)??[]),e]);}
        const total=groups.size+entries.length+superseded.length;let step=0;
        for(const [,group] of groups){ if(group.length>=2){group.sort(canonicalOrder);action('duplicate',group.slice(1).map(e=>e.id),'{}',1,'deterministic');} processed++;await checkpointPhase('deterministic',++step,total); }
        for(const e of entries){if(e.expiresAt&&Date.parse(e.expiresAt)<=Date.now()) action('expire',[e.id],{},1,'deterministic');
          const tags=parse(e.tags); const unread=Date.now()-Date.parse(e.lastReadAt??e.createdAt);
          if(tags.includes('deprecated')&&unread>=options.deprecatedUnreadDays*DAY) action('deprecated',[e.id],{},1,'deterministic');
          processed++;await checkpointPhase('deterministic',++step,total);
        }
        for(const e of superseded){if(e.curatedAt&&Date.now()-Date.parse(e.curatedAt)>14*DAY) action('trash',[e.id],{},1,'deterministic');processed++;await checkpointPhase('deterministic',++step,total);}
        cursor.deterministicDone=true;
      }
      if(!cursor.clusterDone){
        const components=componentsByScope(entries,options.clusterThreshold,this.repository).slice(0,options.maxClusters);
        for(let ci=0;ci<components.length;ci++){
          const component=components[ci];
          for(let offset=0;offset<component.length;offset+=8){const members=component.slice(offset,offset+8);if(members.length<2)continue;
            const candidates=members.map(toJudgeEntry), input:JudgeInput={taskKind:'cluster',entries:candidates,candidateIds:members.map(e=>e.id),hashes:Object.fromEntries(candidates.map(e=>[e.id,e.contentHash])),versions:Object.fromEntries(members.map(e=>[e.id,e.version]))};
            const pairRows:Entry[][]=[];for(let a=0;a<members.length;a++)for(let b=a+1;b<members.length;b++)pairRows.push([members[a],members[b]]);
            const distinctCached=pairRows.length>0&&pairRows.every(pair=>this.repository.findVerdict(pair[0],pair[1])?.verdict==='distinct');
            const judged=distinctCached?null:await this.requestJudge(input,signal);
            assertCurrent();
            if(judged){
              const cluster={candidateIds:input.candidateIds,memberIds:component.map(e=>e.id),threshold:options.clusterThreshold};
              if(judged.verdict==='distinct'&&freshCandidates(this.repository,input,judged.candidateIds))for(const pair of pairRows)this.repository.putVerdict([pair[0].id,pair[1].id],pair.map(toEntryShape),judged.verdict,judged.confidence,judged.reason,judged.model??options.model,new Date().toISOString());
              else if(judged.verdict==='duplicate'){
                const selected=members.filter(e=>judged.candidateIds.includes(e.id)).sort(canonicalOrder); if(selected.length>1&&freshCandidates(this.repository,input,selected.map(e=>e.id))){const draft=deterministicMergeDraft(selected.map(toMergeMember)); action('merge',selected.map(e=>e.id),{canonicalId:selected[0].id,draft:validateMergeDraft(draft),cluster},judged.confidence,'cluster');}
              } else if(judged.verdict==='supersedes'&&judged.payload?.sourceId&&judged.payload.targetId&&freshCandidates(this.repository,input,[judged.payload.sourceId,judged.payload.targetId])) action('supersedes',[judged.payload.sourceId,judged.payload.targetId],{sourceId:judged.payload.sourceId,targetId:judged.payload.targetId,cluster},judged.confidence,'cluster');
              else if(judged.verdict==='complementary'&&freshCandidates(this.repository,input,judged.candidateIds)) action('complementary',judged.candidateIds,{relatedIds:judged.candidateIds},judged.confidence,'cluster');
            }
          }
          await checkpointPhase('cluster',ci+1,components.length);
        }
        cursor.clusterDone=true;
      }
      if(!cursor.agingDone){
        const nowMs=Date.now();
        for(let i=0;i<entries.length;i++){
          const e=entries[i], ageDays=Math.max(0,(nowMs-Date.parse(e.createdAt))/DAY), unreadDays=Math.max(0,(nowMs-(e.lastReadAt?Date.parse(e.lastReadAt):Date.parse(e.createdAt)))/DAY);
          const typeWeight=e.scope.startsWith('workspace:')&&(e.type==='gotcha'||e.type==='fix')?1:e.type==='decision'||e.type==='constraint'?0.25:0.5;
          let score=0.35*Math.min(ageDays/365,1)+0.25*Math.min(unreadDays/180,1)+0.15/(1+Math.max(0,e.readCount??0))+0.15*(1-(e.confidenceScore??1))+0.10*typeWeight;
          if(entries.some(n=>n.id!==e.id&&n.scope===e.scope&&Date.now()-Date.parse(n.updatedAt)<30*DAY))score=Math.max(0,score-0.10);
          if(score>=0.70){const neighbours=entries.filter(n=>n.id!==e.id&&n.scope===e.scope&&n.status==='active'&&Date.parse(n.updatedAt)>Date.parse(e.updatedAt)).sort(canonicalOrder).slice(0,3);
            const input:JudgeInput={taskKind:'aging',entries:[toJudgeEntry(e)],candidateIds:[e.id],hashes:{[e.id]:toJudgeEntry(e).contentHash},versions:{[e.id]:e.version},neighbours:neighbours.map(toJudgeEntry)};
            const judged=await this.requestJudge(input,signal);
            assertCurrent();
            if(judged?.verdict==='outdated'&&freshCandidates(this.repository,input,[e.id]))action('aging',[e.id],{score},judged.confidence,'aging');
          }
          await checkpointPhase('aging',i+1,entries.length);
        } cursor.agingDone=true;
      }
      if(!cursor.restructureDone){
        for(let i=0;i<entries.length;i++){
          const e=entries[i], title=String(e.title), generic=/^(note|notes|update|untitled)$/i.test(title.trim())||!title.trim();
          if(generic){const input:JudgeInput={taskKind:'title',entries:[toJudgeEntry(e)],candidateIds:[e.id],hashes:{[e.id]:toJudgeEntry(e).contentHash},versions:{[e.id]:e.version}};const j=await this.requestJudge(input,signal);
            assertCurrent();
            if(j?.payload?.title&&groundedTitle(j.payload.title,e)&&freshCandidates(this.repository,input,[e.id])) action('title',[e.id],{title:j.payload.title.trim()},j.confidence,'restructure');}
          const tags=parse(e.tags) as string[], aliases:Record<string,string>={javascript:'js',typescript:'ts',bug:'defect',bugs:'defect'};
          const rewritten=tags.map(t=>aliases[t.toLowerCase()]??t);
          if(rewritten.some((tag,index)=>tag!==tags[index])) action('tags',[e.id],{tags:[...new Set(rewritten)]},1,'restructure');
          await checkpointPhase('restructure',i+1,entries.length);
        } cursor.restructureDone=true;
      }
      this.repository.checkpointRun(runId,{...cursor,completed:true},{proposed,applied,processed,failures},'completed',new Date().toISOString());
      return {runId,status:'completed',proposed,applied,processed,failures};
    } catch(error){
      const e=error as Error & {code?:string}; const status=e.code==='CURATION_BUDGET'||e.code==='ABORT_ERR'?'paused':'failed';
      failures.push({phase:String(cursor.phase??'unknown'),error:e.message});
      this.repository.checkpointRun(runId,cursor,{proposed,applied,processed,failures},status,new Date().toISOString(),e.message);
      return {runId,status,proposed,applied,processed,failures};
    } finally { clearInterval(heartbeat);const releasedAt=new Date().toISOString();this.repository.releaseLease(runId,this.owner,releasedAt);this.repository.releaseGlobalLease(this.owner,releasedAt); }
  }

  resume(runId:string, options:CurationOptions, signal?:AbortSignal, checkpoint?:Parameters<CurationEngine['run']>[2]) { return this.run({...options,runId},signal,checkpoint); }
  apply(actionId:string, options?:{actor?:string;draftOverride?:{title:string;content:string}}) {
    const a=this.repository.getAction(actionId); if(!a)throw new Error('Curation action not found');
    let patch:Record<string,unknown>|undefined;
    if(options?.draftOverride){
      if(a.kind!=='merge')throw new Error('Draft override is only valid for merge actions');
      patch={draft:validateMergeDraft(options.draftOverride)};
    }
    const now=new Date().toISOString();
    if(a.kind==='flag')return this.repository.resolveFlag(actionId,now);
    const ids=JSON.parse(a.entry_ids);
    if(options?.actor)patch={...patch,appliedBy:options.actor};
    return applyValidatedAction(this.repository,actionId,a.kind,ids,now,false,patch);
  }
  /** Agent-raised contradiction/quality flag: a proposed `flag` action the user sees in the queue. */
  createFlag(input:{entryId:string;reason:string;actor:string}):{id:string} {
    const entry=this.repository.getEntry(input.entryId); if(!entry)throw new Error('Flag target not found');
    if(!eligible(entry))throw new Error('Flag target is protected or inactive');
    const now=new Date().toISOString(), reason=input.reason.trim().slice(0,500);
    if(!reason)throw new Error('Flag reason is required');
    const key=`flag:${input.entryId}:${contentHash('flag',reason)}`;
    const versions={[entry.id]:{version:entry.version,contentHash:entry.content_hash,scope:entry.scope,status:entry.status}};
    const created=this.repository.createAction({id:randomUUID(),kind:'flag',actor:input.actor,entryIds:[entry.id],snapshot:this.repository.captureSnapshot([entry.id]),payload:{reason},versions,key,now,undoExpiresAt:new Date(Date.now()+30*DAY).toISOString()});
    return {id:created.id as string};
  }
  /** Pending proposals with at most 3 entry excerpts each, for the agent (second-level curation). */
  getQueue(options:{scope?:string;limit?:number;cursor?:string}) {
    const limit=Math.min(25,Math.max(1,options.limit??10));let after:[string,string]|null=null;
    if(options.cursor){try{const p=JSON.parse(Buffer.from(options.cursor,'base64url').toString());if(Array.isArray(p)&&p.length===2&&typeof p[0]==='string'&&typeof p[1]==='string')after=[p[0],p[1]];}catch{}}
    const rows=this.repository.listQueue({scope:options.scope,limit,after}),page=rows.slice(0,limit),last=page.at(-1);
    const actions=page.map(row=>{
      const entryIds=JSON.parse(row.entry_ids) as string[];let payload:any={};try{payload=JSON.parse(row.payload)??{}}catch{}
      const entries=entryIds.slice(0,3).map(id=>this.repository.getEntry(id)).filter(Boolean).map((e:any)=>({id:e.id,title:e.title,excerpt:String(e.content).slice(0,600),scope:e.scope,type:e.type}));
      return {id:row.id as string,kind:row.kind as string,actor:row.actor as string,confidence:row.confidence as number|null,reason:typeof payload.reason==='string'?payload.reason:'',entryIds,createdAt:row.created_at as string,entries};
    });
    return {actions,nextCursor:rows.length>limit&&last?Buffer.from(JSON.stringify([last.created_at,last.id])).toString('base64url'):null};
  }
  reject(actionId:string) { if(!this.repository.setActionStatus(actionId,'proposed','rejected',new Date().toISOString()))throw new Error('Curation action is not pending'); }
  undo(actionId:string) { const action=this.repository.getAction(actionId),now=new Date().toISOString(); if(!(action?.kind==='flag'?this.repository.reopenFlag(actionId,now):this.repository.undoAction(actionId,now)))throw new Error('Curation action is stale, conflicting, or expired'); return {actionId,status:'undone'}; }
  purge(options:{autonomy:CurationOptions['autonomy'];retentionDays:number;batchSize?:number}) {
    if(options.autonomy==='off')return {purged:0};const now=new Date().toISOString();if(!this.repository.acquireGlobalLease(this.owner,now,new Date(Date.now()+60_000).toISOString()))throw new Error('Another curation pipeline holds the database lease');
    try{const cutoff=new Date(Date.now()-options.retentionDays*DAY).toISOString(); const rows=this.repository.listExpiredTrash(cutoff,options.batchSize??100); let purged=0;
      for(const {id} of rows){const e=this.repository.getEntry(id);if(!e||e.status!=='trashed'||e.type==='system'||parse(e.tags).includes('keep'))continue;if(this.repository.transaction(()=>this.repository.purgeEntry(id,cutoff)))purged++;} return {purged};
    }finally{this.repository.releaseGlobalLease(this.owner,new Date().toISOString());}
  }
}

function parse(v:any){try{return typeof v==='string'?JSON.parse(v):v??{}}catch{return {}}}
function parseList(v:any):string[]{try{const x=typeof v==='string'?JSON.parse(v):v;return Array.isArray(x)?x.filter((i:unknown):i is string=>typeof i==='string'):[];}catch{return [];}}
function eligible(e:any){let tags:string[]=[];try{tags=parse(e.tags)}catch{}return e.type!=='system'&&e.status==='active'&&!tags.includes('keep')}
function canonicalOrder(a:any,b:any){return String(b.updated_at??b.updatedAt).localeCompare(String(a.updated_at??a.updatedAt))||String(b.created_at??b.createdAt).localeCompare(String(a.created_at??a.createdAt))||String(a.id).localeCompare(String(b.id))}
function toJudgeEntry(e:any):JudgeEntryData{return{id:e.id,title:e.title,content:e.content.slice(0,12000),tags:parse(e.tags),scope:e.scope,type:e.type,version:e.version,contentHash:e.content_hash??e.contentHash??null}}
function toEntryShape(e:any){return{id:e.id,contentHash:e.content_hash??e.contentHash??null,version:e.version}}
function toMergeMember(e:any):MergeMember{return{id:e.id,title:e.title,content:e.content,tags:parse(e.tags),updatedAt:e.updated_at??e.updatedAt}}
function groundedTitle(title:string,e:any){if(!title.trim()||title.length>500)return false;const source=`${e.title} ${e.content}`.toLowerCase();return title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every(word=>source.includes(word));}
function freshCandidates(repo:CurationRepository,input:JudgeInput,ids:string[]){return ids.every(id=>{const current=repo.getEntry(id),expected=input.entries.find(e=>e.id===id);return !!current&&!!expected&&current.version===input.versions[id]&&current.content_hash===input.hashes[id]&&current.scope===expected.scope&&eligible(current);});}
function componentsByScope(entries:Entry[],threshold:number,repo:CurationRepository) {
  const vectors=new Map(entries.map(e=>[e.id,repo.readVector(e.id)])), scopes=[...new Set(entries.filter(e=>e.scope!=='global').map(e=>e.scope))];if(!scopes.length)scopes.push('global');
  const unique=new Map<string,Entry[]>();
  for(const scope of scopes){const local=scope==='global'?entries.filter(e=>e.scope==='global'):entries.filter(e=>e.scope===scope||e.scope==='global');const pairs:[Entry,Entry][]=[];
    for(let i=0;i<local.length;i++)for(let j=i+1;j<local.length;j++){const a=local[i],b=local[j],x=vectors.get(a.id),y=vectors.get(b.id);if(!x||!y||x.length!==y.length)continue;let dot=0,nx=0,ny=0;for(let k=0;k<x.length;k++){dot+=x[k]*y[k];nx+=x[k]*x[k];ny+=y[k]*y[k]}if(nx&&ny&&dot/Math.sqrt(nx*ny)>=threshold)pairs.push([a,b]);}
    const parent=new Map(local.map(e=>[e.id,e.id]));const find=(x:string):string=>{const p=parent.get(x)!;if(p===x)return x;const root=find(p);parent.set(x,root);return root};for(const[a,b]of pairs){const x=find(a.id),y=find(b.id);if(x!==y)parent.set(y,x)}const groups=new Map<string,Entry[]>();for(const e of local){const root=find(e.id);groups.set(root,[...(groups.get(root)??[]),e]);}
    for(const group of groups.values())if(group.length>1){const sorted=group.sort(canonicalOrder),key=sorted.map(e=>e.id).sort().join(':');if(!unique.has(key))unique.set(key,sorted);}
  }
  return [...unique.values()].sort((a,b)=>a[0].id.localeCompare(b[0].id));
}
// Validate evidence inside the repository transaction immediately before any mutation.
class InvalidCurationEvidence extends Error {}
function applyValidatedAction(repo:CurationRepository,actionId:string,kind:string,ids:string[],now:string,automatic=false,patch?:Record<string,unknown>):boolean {
  try { return repo.applyAction(actionId,now,payload=>{
    if(patch){Object.assign(payload,patch);repo.mergeActionPayload(actionId,patch);}
    if(kind==='aging'&&(!Number.isFinite(payload?.score)||payload.score<0.70))throw new InvalidCurationEvidence('Aging requires a recorded deterministic score >= 0.70');
    if(kind==='merge'||kind==='supersedes'){
      const cluster=payload?.cluster;
      if(automatic||cluster){
        if(!cluster||!Array.isArray(cluster.candidateIds)||!Array.isArray(cluster.memberIds)||!Number.isFinite(cluster.threshold)||cluster.threshold<0||cluster.threshold>1||ids.length<2||ids.some(id=>!cluster.candidateIds.includes(id)||!cluster.memberIds.includes(id)))throw new InvalidCurationEvidence('Participants must belong to the submitted candidate cluster');
        const members=cluster.memberIds.map((id:string)=>repo.getEntry(id)).filter((e:Entry)=>e&&eligible(e));
        if(!componentsByScope(members,cluster.threshold,repo).some(component=>ids.every(id=>component.some(e=>e.id===id))))throw new InvalidCurationEvidence('Participants no longer belong to the similarity cluster');
      }
      if(kind==='supersedes'&&(!ids.includes(payload.sourceId)||!ids.includes(payload.targetId)||payload.sourceId===payload.targetId))throw new InvalidCurationEvidence('Supersede participants must belong to the action');
      if(kind==='merge'&&!ids.includes(payload.canonicalId))throw new InvalidCurationEvidence('Canonical entry must belong to the action');
    }
    applyPayload(repo,kind,ids,payload);
  }); } catch(error) { if(error instanceof InvalidCurationEvidence)return false;throw error; }
}
function applyPayload(repo:CurationRepository,kind:string,ids:string[],payload:any){const now=new Date().toISOString();
  if(kind==='merge'){const canonical=payload.canonicalId as string, others=ids.filter(id=>id!==canonical);const members=ids.map(id=>repo.getEntry(id)).filter(Boolean);const tags=computeMergedTags(members.map(toMergeMember));const draft=validateMergeDraft(payload.draft);const relatedIds=[...new Set(members.flatMap(e=>parseList(e.related_ids)).filter((id:string)=>!others.includes(id)&&id!==canonical))];repo.mutateEntry(canonical,{title:draft.title,content:draft.content,tags,relatedIds},now);for(const id of others)repo.mutateEntry(id,{status:'superseded',supersededBy:canonical},now);}
  else if(kind==='supersedes'){repo.mutateEntry(payload.targetId,{status:'superseded',supersededBy:payload.sourceId},now);}
  else if(kind==='complementary'){for(const id of ids){const e=repo.getEntry(id),related=parseList(e.related_ids);repo.mutateEntry(id,{relatedIds:[...new Set([...related,...ids.filter(other=>other!==id)])]},now);}}
  else if(kind==='title')repo.mutateEntry(ids[0],{title:payload.title},now);
  else if(kind==='tags')for(const id of ids)repo.mutateEntry(id,{tags:payload.tags},now);
  else if(['aging','trash','expire','deprecated','duplicate'].includes(kind))for(const id of ids)repo.mutateEntry(id,{status:'trashed'},now);
}
