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
 const verdicts={Builder:'proceed',Skeptic:'hold',Steward:'proceed',
  Predictor:'proceed',Generator:'proceed',Sentinel:'proceed',Companion:'proceed'};
 let i=0;const order=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];
 const f=async()=>ok(JSON.stringify({verdict:verdicts[order[i++]],confidence:0.5,rationale:'r'}),true)();
 const r=await runReasoningRound({input:'add docs',env:{GEMINI_API_KEY:'k'},fetchImpl:f});
 assert.equal(r.modelInvocations,7);assert.equal(r.aiReasoned,true);assert.equal(r.disagreement,true);
 const d=await runReasoningRound({input:'add docs',env:{}});
 assert.equal(d.aiReasoned,false);assert.equal(d.modelInvocations,0);
});

test('Council workflow exposes model keys only to debate',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
 assert.match(workflow,/GEMINI_API_KEY:\s*\$\{\{ secrets\.GEMINI_API_KEY \}\}/);
 assert.match(workflow,/GROQ_API_KEY:\s*\$\{\{ secrets\.GROQ_API_KEY \}\}/);
 const debate=workflow.split('- name: Run owner-first council debate')[1]?.split('- name: Post council report')[0]||'';
 const actions=workflow.split('- name: Council members act under their own App identities')[1]?.split('- name: Upload receipt artifact')[0]||'';
 assert.match(debate,/GEMINI_API_KEY/);
 assert.match(debate,/GROQ_API_KEY/);
 assert.doesNotMatch(actions,/GEMINI_API_KEY|GROQ_API_KEY/);
 assert.match(actions,/node scripts\/council-act\.mjs/);
 assert.doesNotMatch(actions,/COUNCIL_LEDGER_REQUIRED/);
});

test('all seven model roles are real prompts, not three prompts relabeled seven times',async()=>{
 const {REASONING_ROLES}=await import('../src/council-reasoning.mjs');
 assert.equal(Object.keys(REASONING_ROLES).length,7);
 assert.equal(new Set(Object.values(REASONING_ROLES)).size,7);
 const parsed=parseVerdict(JSON.stringify({verdict:'revise',confidence:0.8,
  rationale:'Test the branch effect',findings:['lib/ledger.js: ambiguous commit'],
  tests:['assert at-most-once dispatch'],disagreements:[]}));
 assert.deepEqual(parsed.findings,['lib/ledger.js: ambiguous commit']);
 assert.deepEqual(parsed.tests,['assert at-most-once dispatch']);
});

test('Groq GPT-OSS uses documented strict structured output; real HOLD remains HOLD',async()=>{
 let request;
 const hold=JSON.stringify({verdict:'hold',confidence:0.8,rationale:'Missing proven SQL context',
  findings:['lib/safe.mjs: context partial'],tests:['node --test test/safe.test.mjs'],
  disagreements:[]});
 const f=async(url,opts)=>{request={url,...opts,body:JSON.parse(opts.body)};
  return {ok:true,status:200,headers:new Map(),json:async()=>({choices:[{message:{content:hold}}]})};};
 const result=await reasonAsRole({role:'Sentinel',input:'review public C04 code evidence',
  env:{GROQ_API_KEY:'test'},order:['groq'],fetchImpl:f});
 assert.equal(result.source,'model');
 assert.equal(result.verdict,'hold','structured response cannot automatically approve a review');
 assert.equal(result.paidInference,false);
 assert.equal(request.body.model,'openai/gpt-oss-20b');
 assert.equal(request.body.reasoning_effort,'low');
 assert.equal(request.body.include_reasoning,false);
 assert.equal(request.body.response_format.type,'json_schema');
 const schema=request.body.response_format.json_schema;
 assert.equal(schema.strict,true);
 assert.deepEqual(schema.schema.required,
  ['verdict','confidence','rationale','findings','tests','disagreements']);
 assert.equal(schema.schema.additionalProperties,false);
 assert.deepEqual(schema.schema.properties.verdict.enum,['proceed','hold','revise']);
});
test('Gemini generateContent asks for bounded structured JSON response',async()=>{
 let request;
 const f=async(url,opts)=>{request=JSON.parse(opts.body);
  return {ok:true,status:200,headers:new Map(),json:async()=>({
   candidates:[{content:{parts:[{text:JSON.stringify({verdict:'proceed',confidence:0.9,
    rationale:'Code evidence sufficient',findings:[],tests:[],disagreements:[]})}]}}]})};};
 const result=await reasonAsRole({role:'Skeptic',input:'public unit-test analysis',
  env:{GEMINI_API_KEY:'test'},order:['google'],fetchImpl:f});
 assert.equal(result.source,'model');
 assert.equal(result.verdict,'proceed');
 assert.equal(request.generationConfig.responseMimeType,'application/json');
 assert.deepEqual(request.generationConfig.responseJsonSchema.properties.verdict.enum,
  ['proceed','hold','revise']);
});

test('release-critical real model roles run before advisory roles under free-tier quota',async()=>{
 const {REASONING_ROLES}=await import('../src/council-reasoning.mjs');
 const used=[];
 const response=JSON.stringify({verdict:'proceed',confidence:0.7,rationale:'bounded source reviewed',
  findings:[],tests:[],disagreements:[]});
 const fetchImpl=async(_url,opts)=>{
  const req=JSON.parse(opts.body);
  const prompt=req.systemInstruction.parts[0].text;
  const role=Object.entries(REASONING_ROLES).find(([,text])=>prompt.startsWith(text))?.[0];
  used.push(role);
  return {ok:true,status:200,headers:new Map(),
   json:async()=>({candidates:[{content:{parts:[{text:response}]}}]})};
 };
 const round=await runReasoningRound({input:'public simulated exact-head source',
  env:{GEMINI_API_KEY:'test'},fetchImpl,order:['google']});
 assert.deepEqual(used.slice(0,3),['Builder','Skeptic','Sentinel'],
  'critical Council release reviewers must not consume leftover quota');
 assert.deepEqual(Object.keys(round.results),Object.keys(REASONING_ROLES),
  'role publication order and identity labels must remain stable');
 assert.equal(round.aiReasoned,true);
});
