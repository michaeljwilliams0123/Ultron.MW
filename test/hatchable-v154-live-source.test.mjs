import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 getWorkersAiReadiness, runWorkersAi, FREE_TIER_NEURON_BUDGET
} from '../cloud/hatchable/lib/cloudflare-workers-ai.js';

const absent={get:async()=>null};
test('deployed Workers AI source is inert without configured credentials',async()=>{
 let requests=0;
 const readiness=await getWorkersAiReadiness({config:absent});
 assert.equal(readiness.ready,false);
 assert.deepEqual(readiness.missingEnvVars,['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_AI_TOKEN']);
 const result=await runWorkersAi({config:absent,mode:'classify',text:'inspect-only',
  fetchImpl:async()=>{requests++;throw Error('unexpected external call')}});
 assert.equal(result.status,503);
 assert.equal(result.error,'workers-ai-not-configured');
 assert.equal(requests,0);
 assert.equal(FREE_TIER_NEURON_BUDGET.ceilingUsd,0);
});
test('invalid modes and unbounded text are denied before network execution',async()=>{
 let requests=0;
 const config={get:async name=>name==='CLOUDFLARE_ACCOUNT_ID'
  ?'a'.repeat(32):'not-real-secret'};
 const fetchImpl=async()=>{requests++;throw Error('unexpected external call')};
 for(const args of [
  {mode:'admin',text:'x'},
  {mode:'classify',text:''},
  {mode:'classify',text:'a'.repeat(8001)},
  {mode:'classify',text:'x',labels:['single']}
 ]){
  const result=await runWorkersAi({...args,config,fetchImpl});
  assert.equal(result.ok,false);
  assert.equal(result.status,400);
 }
 assert.equal(requests,0);
});
test('configured model invocation is exercised only through a local fake response',async()=>{
 const config={get:async key=>key==='CLOUDFLARE_ACCOUNT_ID'
  ?'b'.repeat(32):key==='CLOUDFLARE_AI_TOKEN'?'test-no-real-token':null};
 let calls=0;
 const result=await runWorkersAi({config,mode:'classify',text:'review one issue',
  labels:['urgent','normal'],fetchImpl:async(url,options)=>{
   calls++;
   assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/b{32}\/ai\/run\//);
   assert.equal(options.method,'POST');
   const body=JSON.parse(options.body);
   assert.ok(body.max_tokens<=64);
   return {ok:true,status:200,json:async()=>({success:true,result:{response:'normal'}})};
  }});
 assert.equal(calls,1);
 assert.equal(result.ok,true);
 assert.equal(result.output.label,'normal');
});
test('live-only callback remains HMAC-gated and requires an existing task',()=>{
 const src=readFileSync(new URL('../cloud/hatchable/api/brain/council-deep-callback.js',import.meta.url),'utf8');
 assert.match(src,/export const methods=\['POST'\]/);
 assert.match(src,/verifyHmac/);
 assert.match(src,/signature-invalid/);
 assert.match(src,/council-task-not-found/);
});
