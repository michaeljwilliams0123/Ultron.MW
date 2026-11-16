import test from 'node:test';
import assert from 'node:assert/strict';
import {listChatgptPlanModels,invokeChatgptPlan} from '../src/providers/openai-chatgpt-plan.mjs';
import {reasonAsRole,runReasoningRound} from '../src/council-reasoning.mjs';

const CREDENTIAL={
 kind:'chatgpt-plan-oauth',issuer:'https://auth.openai.com',
 subject:'user-subject-123',client_id:'oaiapp_test',
 access_token:'synthetic-oauth-access-token-not-a-real-credential',
 scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
 saved_at:'2026-11-15T00:00:00.000Z',expires_in:3600
};
const model='gpt-6.1-sol';
const now=Date.parse('2026-11-15T00:01:00Z');
const ok=(body,headers={})=>({ok:true,status:200,headers:{get:k=>headers[k]??null},
 json:async()=>body});
const stream=(events)=>{
 const lines=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('');
 return {ok:true,status:200,body:new ReadableStream({
  start(controller){
   const bytes=new TextEncoder().encode(lines);
   // Deliberately split across JSON boundaries to verify SSE framing.
   controller.enqueue(bytes.slice(0,17));controller.enqueue(bytes.slice(17,59));
   controller.enqueue(bytes.slice(59));controller.close();
  }
 })};
};
const catalog={models:[{slug:model,display_name:'GPT 6.1 Sol',visibility:'list'},
 {slug:'hidden-preview',display_name:'Hidden',visibility:'private'}]};
const successText=JSON.stringify({
 verdict:'proceed',confidence:.92,rationale:'Exact-head CI proof inspected.',
 findings:['src/release.mjs: readback'],tests:['node --test'],disagreements:[]
});
const successEvents=[
 {type:'response.output_text.delta',delta:successText.slice(0,80)},
 {type:'response.output_text.delta',delta:successText.slice(80)},
 {type:'response.completed',response:{status:'completed'}}
];

test('lists only models visible to the explicitly consented account',async()=>{
 const found=await listChatgptPlanModels({credential:CREDENTIAL,now,
  fetchImpl:async(url,req)=>{
   assert.equal(url,'https://api.openai.com/v1/models');
   assert.equal(req.headers.authorization,'Bearer '+CREDENTIAL.access_token);
   return ok(catalog);
  }});
 assert.deepEqual(found,[{slug:model,display_name:'GPT 6.1 Sol'}]);
});

test('bounded OpenAI role call uses only SIWC supported Responses fields and streams to completion',async()=>{
 const calls=[];
 const output=await invokeChatgptPlan({credential:CREDENTIAL,model,now,
  instructions:'You are a strict reviewer.',
  input:'Review this public test fixture.',
  fetchImpl:async(url,req)=>{
   calls.push({url,req});
   if(url.endsWith('/models'))return ok(catalog);
   assert.equal(url,'https://api.openai.com/v1/responses');
   assert.equal(req.method,'POST');
   assert.equal(req.headers.authorization,'Bearer '+CREDENTIAL.access_token);
   const body=JSON.parse(req.body);
   assert.deepEqual(Object.keys(body).sort(),['input','instructions','model','store','stream']);
   assert.equal(body.store,false);assert.equal(body.stream,true);
   assert.deepEqual(body.input,[{role:'user',content:'Review this public test fixture.'}]);
   return stream(successEvents);
  }});
 assert.equal(output,successText);
 assert.equal(calls.length,2);
});

test('no OAuth scope, no consent, expired credentials, or API key cannot call inference',async()=>{
 const bad=[
  {...CREDENTIAL,scope:'openid email'},
  {...CREDENTIAL,kind:'api-key'},
  {...CREDENTIAL,access_token:'sk-plain-api-key'},
  {...CREDENTIAL,expires_in:30}
 ];
 for(const credential of bad){
  let count=0;
  await assert.rejects(()=>invokeChatgptPlan({credential,model,now,
   instructions:'review',input:'public',fetchImpl:async()=>{count++;return ok(catalog)}}));
  assert.equal(count,0);
 }
});

test('unlisted model and non-OpenAI endpoint cannot be selected',async()=>{
 let post=0;
 await assert.rejects(()=>invokeChatgptPlan({credential:CREDENTIAL,model:'hidden-preview',now,
  input:'fixture',instructions:'review',fetchImpl:async(url)=>{if(url.endsWith('/models'))return ok(catalog);post++;return stream(successEvents)}}),
  /model-not-available/);
 assert.equal(post,0);
});

test('a failed or incomplete SSE cannot masquerade as model success',async()=>{
 const variants=[
  [{type:'response.output_text.delta',delta:successText}],
  [{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}],
  [{type:'response.output_text.delta',delta:successText},{type:'response.incomplete',response:{status:'incomplete'}}],
  [{type:'response.completed',response:{status:'completed'}}]
 ];
 for(const events of variants){
  await assert.rejects(()=>invokeChatgptPlan({credential:CREDENTIAL,model,now,
   input:'fixture',instructions:'review',fetchImpl:async url=>url.endsWith('/models')?ok(catalog):stream(events)}));
 }
});

test('local Council opt-in uses OpenAI plan only, never an API-key or paid fallback',async()=>{
 const calls=[];
 const r=await reasonAsRole({role:'Skeptic',input:'Public GitHub fixture\nexact-head green',
  chatgptPlan:{credential:CREDENTIAL,model,now},
  order:['openai-chatgpt'],
  env:{OPENAI_API_KEY:'sk-api-must-not-be-used'},
  fetchImpl:async(url,req)=>{
   calls.push(url);
   return url.endsWith('/models')?ok(catalog):stream(successEvents);
  }});
 assert.equal(r.source,'model');assert.equal(r.provider,'openai-chatgpt');
 assert.equal(r.modelId,model);assert.equal(r.paidInference,false);
 assert.equal(r.verdict,'proceed');
 assert.deepEqual(calls,['https://api.openai.com/v1/models','https://api.openai.com/v1/responses']);
});

test('without ChatGPT consent the owner-only opt-in route holds, never silently uses Gemini/Groq',async()=>{
 const r=await reasonAsRole({role:'Builder',input:'public test',
  order:['openai-chatgpt'],chatgptPlan:null,env:{GEMINI_API_KEY:'ignored'},
  fetchImpl:async()=>{throw Error('network must not run')}});
 assert.equal(r.source,'deterministic-fallback');assert.equal(r.modelInvoked,false);
 assert.equal(r.verdict,'hold');
});

test('every Council logical role can use same owner-consented ChatGPT model without changing identity',async()=>{
 const r=await runReasoningRound({input:'A small, synthetic public source change',order:['openai-chatgpt'],
  chatgptPlan:{credential:CREDENTIAL,model,now},
  fetchImpl:async url=>url.endsWith('/models')?ok(catalog):stream(successEvents)});
 assert.equal(r.modelInvocations,7);
 assert.equal(Object.keys(r.results).length,7);
 for(const result of Object.values(r.results)){
  assert.equal(result.provider,'openai-chatgpt');
  assert.equal(result.source,'model');
 }
});
