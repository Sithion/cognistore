import { afterEach, expect, it, vi } from 'vitest';
import { CurationJudgeClient } from '../../embeddings/src/curation-judge.js';
import { CurationEngine, CurationRepository, type CurationOptions } from '../src/index.js';
import { makeDb } from './helpers.js';

const input={taskKind:'cluster' as const,candidateIds:['a','b'],entries:[{id:'a',title:'A',content:'text A',tags:[],scope:'global',type:'pattern',version:1,contentHash:'ha'},{id:'b',title:'B',content:'text B',tags:[],scope:'global',type:'pattern',version:2,contentHash:'hb'}],hashes:{a:'ha',b:'hb'},versions:{a:1,b:2}};
const response=(object:unknown)=>new Response(JSON.stringify({message:{content:JSON.stringify(object)}}),{status:200,headers:{'Content-Type':'application/json'}});
const valid={verdict:'duplicate',confidence:.9,reason:'same facts',candidateIds:['a','b']};
afterEach(()=>vi.unstubAllGlobals());

it('judge sends JSON Schema keep_alive configured model and cancellation',async()=>{
  const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{calls.push({url,init});return url.endsWith('/api/tags')?new Response(JSON.stringify({models:[{name:'model-x'}]})):response(valid);}));
  const judge=new CurationJudgeClient({host:'http://ollama',model:'model-x'});const result=await judge.judge(input);
  expect(result).toMatchObject({verdict:'duplicate',model:'model-x'});const req=JSON.parse(calls.find(x=>x.url.endsWith('/api/chat')).init.body);expect(req.format).toMatchObject({type:'object',properties:{verdict:{enum:['duplicate','supersedes','complementary','distinct']}}});expect(req.keep_alive).toBe('2m');expect(req.options.temperature).toBe(0);
  const controller=new AbortController();controller.abort();expect(await judge.judge(input,controller.signal)).toBeNull();
});
it('invalid judgments never authorize changes',async()=>{
  for(const invalid of [{...valid,confidence:1.1},{...valid,candidateIds:['outside']},{...valid,reason:''},{...valid,verdict:'outdated'}]){
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/api/tags')?new Response(JSON.stringify({models:[{name:'model-x'}]})):response(invalid)));
    expect(await new CurationJudgeClient({host:'http://ollama',model:'model-x'}).judge(input)).toBeNull();vi.unstubAllGlobals();
  }
});
it('missing Ollama preserves deterministic processing without pulling',async()=>{
  const ctx=makeDb();try{
    await ctx.repository.create({title:'Same',content:'same',tags:[],type:'pattern',scope:'global',source:'test',embedding:[1,...Array(255).fill(0)]});
    await ctx.repository.create({title:'Same',content:'same',tags:[],type:'pattern',scope:'global',source:'test',embedding:[1,...Array(255).fill(0)]});
    const fetcher=vi.fn(async()=>{throw new Error('unavailable')});vi.stubGlobal('fetch',fetcher);
    const opts:CurationOptions={autonomy:'suggest',budgetMs:10000,maxClusters:10,maxItems:10,trashRetentionDays:30,clusterThreshold:.85,deprecatedUnreadDays:180,model:'model-x',trigger:'test'};
    const result=await new CurationEngine(new CurationRepository(ctx.sqlite),new CurationJudgeClient({host:'http://ollama',model:'model-x'})).run(opts);
    expect(result.proposed).toBeGreaterThan(0);expect(fetcher.mock.calls.some(([url])=>String(url).includes('/api/pull'))).toBe(false);
  }finally{ctx.cleanup();}
});
it('installed three-billion fallback preserves model attribution',async()=>{
  const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:any)=>{if(url.endsWith('/api/tags')){const model=JSON.parse(init.body??'{}').model;return new Response(JSON.stringify({models:[{name:'llama3.2:3b'}]}));}calls.push(JSON.parse(init.body).model);return response(valid);}));
  const result=await new CurationJudgeClient({host:'http://ollama',model:'missing-model',installedModels:['llama3.2:3b']}).judge(input);expect(result?.model).toBe('llama3.2:3b');expect(calls).toEqual(['llama3.2:3b']);
});
