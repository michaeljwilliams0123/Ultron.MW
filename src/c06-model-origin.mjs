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
  try{result=invoke(script,c.input);}catch{result='__execution_error__';}
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
  if(invoke(script,c.input)!==c.expected)throw Error('c06-model-cases-rejected');
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
export function c06Prompt(kind,feedback=''){
 const constraints='Public synthetic owner effect canary. No external calls, no credentials, no paid service. ';
 const request=kind==='source'?
  'Return ONLY a complete JavaScript function named fix(input). The function returns one of: held, reconcile, verified. Rule order: if input absent, authorized not exactly true, paused exactly true, or paidCents not integer zero, return held. If providerStatus is unknown or timeout, return reconcile. If providerStatus is observed and receiptVerified exactly true, return verified. Otherwise return held. Use strict equality and Number.isInteger. No code fences or explanation.':
  kind==='cases'?
  'Return ONLY a JSON array of 6-10 unique objects with keys input and expected. Inputs must use authorized,paused,paidCents,providerStatus,receiptVerified. Expected must be held, reconcile or verified. Include valid observed verified, unknown reconcile, timeout reconcile, paused held, unauthorized held and paid >0 held. No markdown.':
  'Write a 170-350 word Markdown runbook explaining owner authorization, paused stop control, paid spend zero, unknown provider outcomes requiring reconcile, verified only with observed receipt, held otherwise. State that independent checks and protected PR merge are required. No secrets or invented results.';
 return [
  {role:'system',content:'You are the Ultron C06 local free CPU model, returning exactly the requested public synthetic artifact. '+constraints},
  {role:'user',content:request+(feedback?'\nPrior output failed validation: '+feedback.slice(0,350)+'. Correct it completely.':'')}
 ];
}
export async function buildC06Artifacts({admission,runId,infer,maxAttempts=3}={}){
 if(admission?.schema!=='ultron.c06.owner-admission.v1'||
  !SOURCE_SHA.test(admission.sourceSha||'')||typeof infer!=='function'||
  !/^\d{1,20}$/.test(String(runId||''))||!Number.isSafeInteger(maxAttempts)||
  maxAttempts<1||maxAttempts>3)throw Error('c06-model-output-rejected');
 const raw={},processed={};
 for(const kind of ['source','cases','docs']){
  let failure='';
  for(let i=1;i<=maxAttempts;i++){
   const reply=await infer(kind,c06Prompt(kind,failure),i);
   try{
    if(typeof reply!=='string'||reply.length>4500)throw Error('invalid-output');
    const normalized=kind==='source'?evaluateC06Function(reply):
      kind==='cases'?normalizeCases(reply,processed.source.code):normalizeDocs(reply);
    if(kind==='source'&&!normalized.passed)throw Error(normalized.reason+
      ' '+normalized.failures.slice(0,4).map(f=>f.id+' expected '+f.expected).join(','));
    raw[kind]=reply;
    processed[kind]=normalized;
    failure='';
    break;
   }catch(e){failure=String(e.message).slice(0,200);}
  }
  if(failure)throw Error('c06-model-'+kind+'-rejected: '+failure);
 }
 const source='/* Ultron model-origin C06 source. Independent acceptance required. */\nexport '+
  processed.source.code+'\n';
 const generatedCases=JSON.stringify(processed.cases,null,2);
 const testFile=`/* Ultron model-generated test vectors; deterministic Node test wrapper. */\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {fix} from '../lib/c06-model-candidate.js';\nconst generated = ${generatedCases};\ntest('C06 model-generated owner-effect regression vectors',()=>{\n for(const row of generated)assert.equal(fix(row.input),row.expected);\n});\n`;
 const docs='# C06 model-generated owner effect contract\n\n'+processed.docs;
 const files={[C06_PATHS.source]:source,[C06_PATHS.tests]:testFile,
  [C06_PATHS.docs]:docs};
 const output=Object.fromEntries(Object.entries(files).map(([path,value])=>[
  path,{sha256:SHA(value),bytes:Buffer.byteLength(value)}]));
 const receipt={
  schema:'ultron.c06.model-origin.v1',issueNumber:245,
  sourceSha:admission.sourceSha,runId:String(runId),origin:'model-inference-not-assistant-authored',
  model:admission.model,modelRevision:admission.revision,
  license:admission.license,paidCents:0,productionAccepted:false,
  generation:'model-authored-function+test-vectors+docs;fixed-safe-wrappers',
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
 if(!files[C06_PATHS.source].includes('export function fix(input)')||
  !files[C06_PATHS.tests].includes('model-generated')||
  !files[C06_PATHS.docs].includes('C06 model-generated'))fail();
 return Object.freeze({valid:true,sourceSha,runId:String(runId),receiptDigest,
  paths:Object.keys(receipt.outputs)});
}
