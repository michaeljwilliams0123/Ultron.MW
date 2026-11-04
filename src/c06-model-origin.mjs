/** Owner-authorized, zero-paid, source-attributed C06 model canary.
 * Synthetic public inputs only. Model code executes solely in an ephemeral,
 * secret-free CPU job. Node vm is NOT a hardened sandbox for hostile code.
 */
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {normalizeRepairOutput} from './hf-repair-output.mjs';

const SOURCE_SHA=/^[a-f0-9]{40}$/;
const MODEL='onnx-community/Qwen2.5-Coder-1.5B-Instruct';
const REVISION='774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf';
const LICENSE='apache-2.0';
const UNSAFE=/\b(?:process|global|globalThis|require|fetch|import|eval|Function|constructor|prototype|__proto__|while|for|class|this|WebAssembly|setTimeout|setInterval|Symbol|Reflect|async|await)\b/;
const SHA=value=>createHash('sha256').update(value).digest('hex');
export const C06_PATHS=Object.freeze({
 source:'lib/c06-model-candidate.js',tests:'test/c06-model-generated.test.mjs',
 docs:'docs/c06-model-generated.md',evidence:'evidence/c06-model-origin.json'
});
const good={authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true};
const caseOf=(id,input,expected)=>Object.freeze({id,input:Object.freeze(input),expected});
export const C06_CASES=Object.freeze([
 caseOf('verified',good,'verified'),
 caseOf('no-authority',{...good,authorized:false},'held'),
 caseOf('owner-paused',{...good,paused:true},'held'),
 caseOf('paid-positive',{...good,paidCents:1},'held'),
 caseOf('paid-negative',{...good,paidCents:-1},'held'),
 caseOf('paid-fraction',{...good,paidCents:0.5},'held'),
 caseOf('paid-string',{...good,paidCents:'0'},'held'),
 caseOf('uncertain',{...good,providerStatus:'unknown',receiptVerified:false},'reconcile'),
 caseOf('timeout',{...good,providerStatus:'timeout'},'reconcile'),
 caseOf('no-receipt',{...good,receiptVerified:false},'held'),
 caseOf('provider-forbidden',{...good,providerStatus:'forbidden'},'held'),
 caseOf('provider-absent',{...good,providerStatus:null},'held'),
 caseOf('no-input',null,'held'),
 caseOf('unknown-with-pause',{...good,providerStatus:'unknown',paused:true},'held'),
 caseOf('unknown-with-payment',{...good,providerStatus:'unknown',paidCents:2},'held')
]);

export function admitC06(input={}){
 if(input.repository!=='michaeljwilliams0123/Ultron.MW'||
  input.actor!=='michaeljwilliams0123'||input.publicRepository!==true||
  input.paidBudgetCents!==0||input.runner!=='ubuntu-24.04'||
  input.issueNumber!==245||!SOURCE_SHA.test(input.sourceSha||''))
  throw Error('c06-admission-denied');
 return Object.freeze({schema:'ultron.c06.owner-admission.v1',
  repository:input.repository,actor:input.actor,sourceSha:input.sourceSha,
  model:MODEL,revision:REVISION,license:LICENSE,issueNumber:245,
  paidBudgetCents:0,runner:'ubuntu-24.04',modelUse:'cpu-evaluation-only'});
}
function candidateScript(code){
 return new vm.Script('('+code+')(input)',{filename:'c06-candidate.mjs'});
}
function invoke(script,input){
 const context=vm.createContext({input:structuredClone(input)},
  {codeGeneration:{strings:false,wasm:false}});
 return script.runInContext(context,{timeout:125});
}
/** Independently authored; the model never receives these authority fields. */
function guardedDecision(script,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
   input.authorized!==true||input.paused!==false||
   !Number.isInteger(input.paidCents)||input.paidCents!==0)
  return 'held';
 return invoke(script,{providerStatus:input.providerStatus,
  receiptVerified:input.receiptVerified});
}
export function evaluateC06Function(reply){
 const invalid=(reason)=>Object.freeze({passed:false,reason,
  correct:0,total:C06_CASES.length,failures:[]});
 const normalized=normalizeRepairOutput(reply);
 if(!normalized.code||normalized.code.length<100||normalized.code.length>1400)
  return invalid('invalid-function');
 const code=normalized.code;
 if(UNSAFE.test(code)||/\bnew\s+[A-Za-z_$]/.test(code)||
  !/^function fix\(input\)\s*\{[\s\S]+\}$/.test(code))
  return invalid('unsafe-or-nonconforming-function');
 let script;
 try{script=candidateScript(code);}
 catch{return invalid('syntax-error');}
 const failures=[];
 let correct=0;
 for(const c of C06_CASES){
  let result;
  try{result=guardedDecision(script,c.input);}catch{result='__execution_error__';}
  if(result===c.expected)correct++;
  else failures.push({id:c.id,expected:c.expected,actual:
   typeof result==='string'?result.slice(0,30):'<non-string>'});
 }
 return Object.freeze({passed:correct===C06_CASES.length,reason:
  correct===C06_CASES.length?'verified':'behavior-mismatch',
  correct,total:C06_CASES.length,failures,code,format:normalized.format});
}
function normalizeCases(reply,code){
 if(typeof reply!=='string'||reply.length>4000)throw Error('c06-model-cases-rejected');
 let raw=reply.trim();
 if(raw.startsWith('```json\n')&&raw.endsWith('\n```'))
  raw=raw.slice(8,-4).trim();
 let cases;
 try{cases=JSON.parse(raw);}catch{throw Error('c06-model-cases-rejected');}
 if(!Array.isArray(cases)||cases.length<6||cases.length>10)
  throw Error('c06-model-cases-rejected');
 const allowed=['authorized','paused','paidCents','providerStatus','receiptVerified'];
 const results=new Set(),unique=new Set();
 const script=candidateScript(code);
 for(const c of cases){
  if(!c||typeof c!=='object'||Array.isArray(c)||
   Object.keys(c).sort().join(',')!=='expected,input'||
   !c.input||typeof c.input!=='object'||Array.isArray(c.input)||
   Object.keys(c.input).some(k=>!allowed.includes(k))||
   !['held','reconcile','verified'].includes(c.expected))
   throw Error('c06-model-cases-rejected');
  const signature=JSON.stringify(c.input);
  if(unique.has(signature))throw Error('c06-model-cases-rejected');
  unique.add(signature);
  if(guardedDecision(script,c.input)!==c.expected)throw Error('c06-model-cases-rejected');
  results.add(c.expected);
 }
 if(!['held','reconcile','verified'].every(x=>results.has(x)))
  throw Error('c06-model-cases-rejected');
 const bad=cases.filter(x=>x.expected==='held'&&
  (x.input.authorized===false||x.input.paused===true||x.input.paidCents!==0));
 if(bad.length<2)throw Error('c06-model-cases-rejected');
 return cases;
}
function normalizeDocs(reply){
 if(typeof reply!=='string'||reply.length<150||reply.length>2500||
  !['owner','paid','reconcile','verified','held'].every(k=>
   reply.toLowerCase().includes(k))||
  /(?:OPENAI_API_KEY|PRIVATE KEY|sk-proj-)/i.test(reply))
  throw Error('c06-model-docs-rejected');
 return reply.trim()+'\n';
}
/** Model must author each complete JSON object; these independent scenario
 * constraints are validation only, never used to synthesize fallback output. */
const C06_CASE_SCENARIOS=Object.freeze([
 Object.freeze({id:'observed-verified',input:{authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'verified'}),
 Object.freeze({id:'unknown-reconcile',input:{authorized:true,paused:false,paidCents:0,providerStatus:'unknown',receiptVerified:false},expected:'reconcile'}),
 Object.freeze({id:'timeout-reconcile',input:{authorized:true,paused:false,paidCents:0,providerStatus:'timeout',receiptVerified:false},expected:'reconcile'}),
 Object.freeze({id:'paused-held',input:{authorized:true,paused:true,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'}),
 Object.freeze({id:'unauthorized-held',input:{authorized:false,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'}),
 Object.freeze({id:'paid-held',input:{authorized:true,paused:false,paidCents:1,providerStatus:'observed',receiptVerified:true},expected:'held'}),
 Object.freeze({id:'unverified-held',input:{authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:false},expected:'held'})
]);
function validateChunk(reply,scenario,source){
 if(typeof reply!=='string'||reply.length>900)throw Error('invalid-small-model-output');
 let value=reply.trim();
 if(value.startsWith('\`\`\`json\n')&&value.endsWith('\n\`\`\`'))value=value.slice(8,-4).trim();
 let proposed;
 try{proposed=JSON.parse(value);}catch{throw Error('invalid-single-case-json');}
 if(!proposed||typeof proposed!=='object'||Array.isArray(proposed)||
    Object.keys(proposed).sort().join(',')!=='expected,input'||
    !proposed.input||typeof proposed.input!=='object'||Array.isArray(proposed.input)||
    Object.keys(proposed.input).sort().join(',')!==
     'authorized,paidCents,paused,providerStatus,receiptVerified'||
    proposed.expected!==scenario.expected)
  throw Error('invalid-single-case-fields');
 for(const [key,expected] of Object.entries(scenario.input))
  if(proposed.input[key]!==expected)throw Error('scenario-constraint-failed-'+key);
 const script=candidateScript(source);
 if(guardedDecision(script,proposed.input)!==proposed.expected)
  throw Error('generated-case-behavior-mismatch');
 return proposed;
}
async function generateChunkedCases({source,infer,maxAttempts}){
 const all=[],rawReplies=[];
 for(const scenario of C06_CASE_SCENARIOS){
  let failure='',valid=false;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   const reply=await infer('case',c06Prompt('case',failure,scenario),attempt);
   try{
    const testCase=validateChunk(reply,scenario,source);
    all.push(testCase);rawReplies.push(reply);valid=true;break;
   }catch(e){
    failure=String(e.message||'invalid-generated-case').slice(0,200);
   }
  }
  if(!valid)throw Error('c06-model-cases-rejected: '+scenario.id+' '+failure);
 }
 return Object.freeze({cases:normalizeCases(JSON.stringify(all),source),
   rawResponses:rawReplies});
}

export function c06Prompt(kind,feedback='',scenario=null){
 const constraints='Public synthetic owner effect canary. No external calls, no credentials, no paid service. ';
 const request=kind==='case'&&scenario?
  'Scenario: '+scenario.id+'. Return ONLY a valid JSON object with EXACTLY two top-level keys: input and expected. Input must contain all five keys authorized,paused,paidCents,providerStatus,receiptVerified, and exactly these values: '+
  JSON.stringify(scenario.input)+'. The expected outcome is '+JSON.stringify(scenario.expected)+'. Do not omit fields; do not use Markdown, explanation or other text.':
  kind==='source'?
  'Return ONLY a complete JavaScript function named fix(input) that classifies the provider state. The independent owner and paid-spend guard is outside this function and cannot be edited. Your input has ONLY providerStatus and receiptVerified. If providerStatus is unknown or timeout, return reconcile. If providerStatus is observed AND receiptVerified is exactly true, return verified. For every other provider state or missing receipt, return held. Use strict === comparisons. No code fences, imports, API calls, explanation or extra text.':
  kind==='cases'?
  'Return ONLY a JSON array of 6-10 unique objects with keys input and expected. Inputs must use authorized,paused,paidCents,providerStatus,receiptVerified. Expected must be held, reconcile or verified. Include valid observed verified, unknown reconcile, timeout reconcile, paused held, unauthorized held and paid >0 held. No markdown.':
  'Write a 170-350 word Markdown runbook explaining owner authorization, paused stop control, paid spend zero, unknown provider outcomes requiring reconcile, verified only with observed receipt, held otherwise. State that independent checks and protected PR merge are required. No secrets or invented results.';
 return [
  {role:'system',content:'You are the Ultron C06 local free CPU model, returning exactly the requested public synthetic artifact. '+constraints},
  {role:'user',content:request+(feedback?'\nPrior output failed validation. Previous candidate and test observations follow:\n'+feedback.slice(0,1900)+'\nRewrite the complete artifact from this feedback, not merely one line.':'')}
 ];
}
export async function buildC06Artifacts({admission,runId,infer,maxAttempts=3}={}){
 if(admission?.schema!=='ultron.c06.owner-admission.v1'||
  !SOURCE_SHA.test(admission.sourceSha||'')||typeof infer!=='function'||
  !/^\d{1,20}$/.test(String(runId||''))||!Number.isSafeInteger(maxAttempts)||
  maxAttempts<1||maxAttempts>3)throw Error('c06-model-output-rejected');
 const raw={},processed={};
 for(const kind of ['source','cases','docs']){
  if(kind==='cases'&&maxAttempts>1){
   const first=await infer('cases',c06Prompt('cases'),1);
   try{
    if(typeof first!=='string'||first.length>4500)throw Error('invalid-output');
    processed.cases=normalizeCases(first,processed.source.code);
    raw.cases=first;
    processed.testVectorMode='bulk-model-generated';
   }catch{
    const chunks=await generateChunkedCases({source:processed.source.code,
     infer,maxAttempts});
    processed.cases=chunks.cases;
    raw.cases=JSON.stringify(chunks.rawResponses);
    processed.testVectorMode='individually-model-generated';
   }
   continue;
  }
  let failure='';
  for(let i=1;i<=maxAttempts;i++){
   const reply=await infer(kind,c06Prompt(kind,failure),i);
   try{
    if(typeof reply!=='string'||reply.length>4500)throw Error('invalid-output');
    const normalized=kind==='source'?evaluateC06Function(reply):
      kind==='cases'?normalizeCases(reply,processed.source.code):normalizeDocs(reply);
    if(kind==='source'&&!normalized.passed){
      const observations=normalized.failures.slice(0,6).map(f=>{
       const scenario=C06_CASES.find(c=>c.id===f.id);
       return f.id+' input '+JSON.stringify(scenario?.input)+
        ' expected '+f.expected+' but received '+f.actual;
      }).join('; ');
      throw Error('Previous candidate:\n'+reply.slice(0,1150)+
       '\nIndependent test failures: '+observations+'\nReason: '+normalized.reason);
    }
    raw[kind]=reply;
    processed[kind]=normalized;
    if(kind==='cases')processed.testVectorMode='bulk-model-generated';
    failure='';
    break;
   }catch(e){failure=String(e.message).slice(0,1900);}
  }
  if(failure)throw Error('c06-model-'+kind+'-rejected: '+failure);
 }
 // Normalize whitespace-only blank lines before hashing and publishing.
 // Raw, unmodified model replies retain their distinct SHA256 provenance.
 const canonicalBlankLines=value=>value.replace(/^[ \t]+$/gm,'');
 const source=canonicalBlankLines('/* Ultron C06: model-authored provider function with separately owned authority fence. */\n'+
  processed.source.code+'\n'+
  "export function classifyC06Effect(input) {\n"+
  " if (!input || typeof input !== 'object' || Array.isArray(input) ||\n"+
  "  input.authorized !== true || input.paused !== false ||\n"+
  "  !Number.isInteger(input.paidCents) || input.paidCents !== 0) return 'held';\n"+
  " return fix({providerStatus:input.providerStatus,receiptVerified:input.receiptVerified});\n"+
  "}\n");
 const generatedCases=JSON.stringify(processed.cases,null,2);
 const testFile=`/* Ultron model-generated test vectors; deterministic Node test wrapper. */\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {classifyC06Effect as fix} from '../lib/c06-model-candidate.js';\nconst generated = ${generatedCases};\ntest('C06 model-generated owner-effect regression vectors',()=>{\n for(const row of generated)assert.equal(fix(row.input),row.expected);\n});\n`;
 const docs=canonicalBlankLines('# C06 model-generated owner effect contract\n\n'+processed.docs);
 const files={[C06_PATHS.source]:source,[C06_PATHS.tests]:testFile,
  [C06_PATHS.docs]:docs};
 const output=Object.fromEntries(Object.entries(files).map(([path,value])=>[
  path,{sha256:SHA(value),bytes:Buffer.byteLength(value)}]));
 const receipt={
  schema:'ultron.c06.model-origin.v1',issueNumber:245,
  sourceSha:admission.sourceSha,runId:String(runId),origin:'model-inference-not-assistant-authored',
  model:admission.model,modelRevision:admission.revision,
  testVectorMode:processed.testVectorMode,
  license:admission.license,paidCents:0,productionAccepted:false,
  generation:'model-authored-provider-function+test-vectors+docs;fixed-independent-owner-stop-spend-fence',
  generatedRawHashes:Object.fromEntries(Object.entries(raw).map(([kind,value])=>[kind,SHA(value)])),
  outputs:output,independentCaseCount:C06_CASES.length,
  independentCorrect:processed.source.correct
 };
 const receiptDigest=SHA(JSON.stringify(receipt));
 files[C06_PATHS.evidence]=JSON.stringify({...receipt,receiptDigest},null,2)+'\n';
 return {files,receipt:Object.freeze({...receipt,receiptDigest})};
}
export function verifyC06Files(files,{sourceSha,runId}={}){
 const fail=()=>{throw Error('c06-provenance-invalid');};
 let receipt;
 try{receipt=JSON.parse(files?.[C06_PATHS.evidence]);}catch{fail();}
 if(receipt?.schema!=='ultron.c06.model-origin.v1'||
  receipt.issueNumber!==245||receipt.sourceSha!==sourceSha||
  receipt.runId!==String(runId)||receipt.origin!=='model-inference-not-assistant-authored'||
  receipt.model!==MODEL||receipt.modelRevision!==REVISION||
  receipt.license!==LICENSE||receipt.paidCents!==0||
  !['bulk-model-generated','individually-model-generated'].includes(receipt.testVectorMode)||
  receipt.productionAccepted!==false||
  receipt.independentCaseCount!==C06_CASES.length||
  receipt.independentCorrect!==C06_CASES.length)fail();
 const {receiptDigest,...body}=receipt;
 if(SHA(JSON.stringify(body))!==receiptDigest)fail();
 if(Object.keys(receipt.outputs||{}).sort().join(',')!==
  [C06_PATHS.docs,C06_PATHS.source,C06_PATHS.tests].sort().join(','))fail();
 for(const [path,item] of Object.entries(receipt.outputs)){
  if(typeof files[path]!=='string'||SHA(files[path])!==item.sha256||
   Buffer.byteLength(files[path])!==item.bytes||item.bytes>12000)fail();
 }
 if(!files[C06_PATHS.source].includes('export function classifyC06Effect(input)')||
  !files[C06_PATHS.tests].includes('model-generated')||
  !files[C06_PATHS.docs].includes('C06 model-generated'))fail();
 return Object.freeze({valid:true,sourceSha,runId:String(runId),receiptDigest,
  paths:Object.keys(receipt.outputs)});
}
