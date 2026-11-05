import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkExternalInput,parseVerdict,reasonAsRole,runReasoningRound,PROVIDERS} from '../src/council-reasoning.mjs';

const ok=(text,isGoogle)=>async()=>({ok:true,status:200,headers:new Map([['x-ratelimit-remaining-requests','9']]),
 json:async()=>isGoogle?{candidates:[{content:{parts:[{text}]}}]}:{choices:[{message:{content:text}}]}});
const V='{"verdict":"proceed","confidence":0.7,"rationale":"fine","disagreements":[]}';

test('models are the owner-chosen free tier ones',()=>{
 assert.equal(PROVIDERS.google.model,'gemini-3.5-flash-lite');
 assert.equal(PROVIDERS.groq.model,'openai/gpt-oss-20b');
});
test('input gate blocks secrets, private markers, empty and oversize',()=>{
 assert.equal(checkExternalInput('token ghp_'+'a'.repeat(30)).ok,false);
 assert.equal(checkExternalInput('Mahoraga-private notes').ok,false);
 assert.equal(checkExternalInput('').ok,false);
 assert.equal(checkExternalInput('x'.repeat(7000)).ok,false);
 assert.equal(checkExternalInput('add a README line').ok,true);
});
test('parseVerdict rejects invalid and clamps confidence',()=>{
 assert.equal(parseVerdict('nope'),null);
 assert.equal(parseVerdict('{"verdict":"maybe"}'),null);
 assert.equal(parseVerdict('x {"verdict":"hold","confidence":5} y').confidence,1);
});
test('primary Gemini success is labelled as model reasoning',async()=>{
 const r=await reasonAsRole({role:'Builder',input:'add docs',env:{GEMINI_API_KEY:'k'},fetchImpl:ok(V,true)});
 assert.equal(r.source,'model');assert.equal(r.provider,'google');assert.equal(r.modelInvoked,true);assert.equal(r.paidInference,false);
});
test('rate-limited primary falls to Groq; both exhausted falls back explicitly and queues',async()=>{
 let n=0;
 const f=async(u)=>{n++;return u.includes('googleapis')?{ok:false,status:429,headers:new Map()}:ok(V,false)()};
 const r=await reasonAsRole({role:'Skeptic',input:'add docs',env:{GEMINI_API_KEY:'k',GROQ_API_KEY:'g'},fetchImpl:f});
 assert.equal(r.provider,'groq');assert.equal(r.attempts[0].outcome,'rate-limited');
 const x=await reasonAsRole({role:'Skeptic',input:'add docs',env:{GEMINI_API_KEY:'k',GROQ_API_KEY:'g'},fetchImpl:async()=>({ok:false,status:429,headers:new Map()})});
 assert.equal(x.source,'deterministic-fallback');assert.equal(x.modelInvoked,false);assert.equal(x.queued,true);
});
test('no credentials never claims AI; blocked input never reaches network',async()=>{
 let called=0;
 const a=await reasonAsRole({role:'Builder',input:'hello',env:{},fetchImpl:async()=>{called++}});
 assert.equal(a.fallbackReason,'no-credentials');assert.equal(a.modelInvoked,false);
 const b=await reasonAsRole({role:'Builder',input:'key AIza'+'b'.repeat(30),env:{GEMINI_API_KEY:'k'},fetchImpl:async()=>{called++}});
 assert.match(b.fallbackReason,/input-blocked/);assert.equal(called,0);
});
test('round records invocations and disagreement',async()=>{
 const verdicts={Builder:'proceed',Skeptic:'hold',Sentinel:'proceed'};
 let i=0;const order=['Builder','Skeptic','Sentinel'];
 const f=async()=>ok(JSON.stringify({verdict:verdicts[order[i++]],confidence:0.5,rationale:'r'}),true)();
 const r=await runReasoningRound({input:'add docs',env:{GEMINI_API_KEY:'k'},fetchImpl:f});
 assert.equal(r.modelInvocations,3);assert.equal(r.aiReasoned,true);assert.equal(r.disagreement,true);
 const d=await runReasoningRound({input:'add docs',env:{}});
 assert.equal(d.aiReasoned,false);assert.equal(d.modelInvocations,0);
});

test('Council workflow forwards external model keys only to debate and ledger flag only to actions',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
 assert.match(workflow,/GEMINI_API_KEY:\s*\$\{\{ secrets\.GEMINI_API_KEY \}\}/);
 assert.match(workflow,/GROQ_API_KEY:\s*\$\{\{ secrets\.GROQ_API_KEY \}\}/);
 assert.match(workflow,/COUNCIL_LEDGER_REQUIRED:\s*\$\{\{ vars\.COUNCIL_LEDGER_REQUIRED \}\}/);
 const debate=workflow.split('- name: Run owner-first council debate')[1]?.split('- name: Post council report')[0]||'';
 const actions=workflow.split('- name: Council members act under their own App identities')[1]?.split('- name: Upload receipt artifact')[0]||'';
 assert.match(debate,/GEMINI_API_KEY/);
 assert.match(debate,/GROQ_API_KEY/);
 assert.doesNotMatch(actions,/GEMINI_API_KEY|GROQ_API_KEY/);
 assert.match(actions,/COUNCIL_LEDGER_REQUIRED/);
});
