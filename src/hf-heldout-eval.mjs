/** Independent behavioral scoring for synthetic code-repair candidates.
 * This is evaluation-only code run on a public, read-only ephemeral CI runner.
 * Node vm is a bounded scorer, NOT a general security sandbox; never put
 * credentials, filesystem/network permissions or private code in its context.
 */
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {HELDOUT_REPAIR_CASES,heldoutCorpusDigest} from './hf-heldout-cases.mjs';
import {FREE_CPU_MODELS} from './hf-free-compute.mjs';

const SHA=/^[a-f0-9]{40}$/;
const PROPOSAL=/^function fix\(input\)\s*\{[\s\S]+\}$/;
const UNSAFE=/\b(?:process|global|globalThis|require|fetch|import|eval|Function|constructor|prototype|__proto__|while|for|class|this|WebAssembly|async|await|setTimeout|setInterval|Symbol|Reflect)\b/;
const REASONS=new Set(['verified','behavior-mismatch','unsafe-proposal',
 'invalid-function','syntax-error','execution-error']);
export function heldoutShard(n){
 if(n!==0&&n!==1)throw Error('invalid-heldout-shard');
 return Object.freeze(HELDOUT_REPAIR_CASES.filter((_,i)=>i%2===n));
}

function runFunction(source,input){
 const script=new vm.Script('('+source+')(input)',{filename:'heldout-candidate.mjs'});
 const context=vm.createContext({input:structuredClone(input)},{
  codeGeneration:{strings:false,wasm:false}});
 return script.runInContext(context,{timeout:150});
}

export function scoreProposedRepair(testCase,raw){
 const id=testCase?.id;
 const vectorCount=testCase?.vectors?.length??0;
 const out=(reason,correctVectors=0)=>Object.freeze({
  id,passed:reason==='verified',vectorCount,correctVectors,reason});
 if(!HELDOUT_REPAIR_CASES.includes(testCase)||typeof raw!=='string'||
    raw.length>900)return out('invalid-function');
 const source=raw.trim();
 if(UNSAFE.test(source)||/\\bnew\\s+[A-Za-z_$]/.test(source))return out('unsafe-proposal');
 if(!PROPOSAL.test(source)||source.match(/\bfunction\b/g)?.length!==1)
  return out('invalid-function');
 try{new vm.Script('('+source+')');}
 catch{return out('syntax-error');}
 let correct=0;
 for(const vector of testCase.vectors){
  try{
   const result=runFunction(source,vector.input);
   if(Object.is(result,vector.expected))correct++;
  }catch{return out('execution-error',correct);}
 }
 return out(correct===vectorCount?'verified':'behavior-mismatch',correct);
}

export function admitHeldoutCpu(input={}){
 if(input.repository!=='michaeljwilliams0123/Ultron.MW'||
  input.isPublic!==true||input.runner!=='ubuntu-24.04'||
  input.parallel!==4||input.gpu!==false||input.costCents!==0||
  input.shards!==2)throw Error('heldout-cpu-admission-denied');
 return Object.freeze({schema:'ultron.hf.heldout-plan.v1',
  maxParallel:4,totalModelJobs:6,shards:2,maxNewTokens:256,
  paidBudgetCents:0,runner:'ubuntu-24.04',device:'cpu'});
}

export function makeHeldoutReceipt(input){
 const fail=()=>{throw Error('invalid-heldout-receipt');};
 if(!input||!Object.hasOwn(FREE_CPU_MODELS,input.profile)||
  !SHA.test(input.revision||'')||!SHA.test(input.sourceSha||'')||
  !Number.isSafeInteger(input.shard)||![0,1].includes(input.shard)||
  !Number.isSafeInteger(input.durationMs)||input.durationMs<0||
  input.paidCents!==0||!Array.isArray(input.cases)||
  input.cases.length!==8)fail();
 const expected=heldoutShard(input.shard).map(c=>c.id);
 if(input.cases.some((c,i)=>c?.id!==expected[i]||
  !Number.isSafeInteger(c.vectorCount)||c.vectorCount<3||
  !Number.isSafeInteger(c.correctVectors)||c.correctVectors<0||
  c.correctVectors>c.vectorCount||
  typeof c.passed!=='boolean'||!REASONS.has(c.reason)||
  (c.passed!==(c.reason==='verified'))||
  (c.passed&&c.correctVectors!==c.vectorCount)))fail();
 const immutable={
  schema:'ultron.hf.heldout-repair.v1',profile:input.profile,
  model:FREE_CPU_MODELS[input.profile].id,revision:input.revision,
  sourceSha:input.sourceSha,corpusDigest:heldoutCorpusDigest(),
  shard:input.shard,paidCents:0,durationMs:input.durationMs,
  caseCount:input.cases.length,
  passed:input.cases.filter(c=>c.passed).length,
  cases:input.cases.map(c=>({id:c.id,passed:c.passed,
   vectorCount:c.vectorCount,correctVectors:c.correctVectors,reason:c.reason})),
 };
 const digest=createHash('sha256').update(JSON.stringify(immutable)).digest('hex');
 return Object.freeze({...immutable,digest});
}
