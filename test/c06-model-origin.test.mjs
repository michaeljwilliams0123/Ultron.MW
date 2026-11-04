import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {admitC06, evaluateC06Function, buildC06Artifacts, verifyC06Files,
  C06_CASES, C06_PATHS} from '../src/c06-model-origin.mjs';

const sha='a'.repeat(40);
const allowed={repository:'michaeljwilliams0123/Ultron.MW',actor:'michaeljwilliams0123',
 publicRepository:true,paidBudgetCents:0,sourceSha:sha,issueNumber:245,runner:'ubuntu-24.04'};
const functionSource=`function fix(input) {
 if (input?.authorized !== true || input?.paused === true) return 'held';
 if (!Number.isInteger(input?.paidCents) || input.paidCents !== 0) return 'held';
 if (input?.providerStatus === 'unknown' || input?.providerStatus === 'timeout') return 'reconcile';
 if (input?.providerStatus === 'observed' && input?.receiptVerified === true) return 'verified';
 return 'held';
}`;
const tests=JSON.stringify([
 {input:{authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'verified'},
 {input:{authorized:true,paused:false,paidCents:0,providerStatus:'unknown',receiptVerified:false},expected:'reconcile'},
 {input:{authorized:true,paused:false,paidCents:0,providerStatus:'timeout',receiptVerified:true},expected:'reconcile'},
 {input:{authorized:true,paused:true,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'},
 {input:{authorized:false,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'},
 {input:{authorized:true,paused:false,paidCents:1,providerStatus:'observed',receiptVerified:true},expected:'held'}
]);
const docs='# Model-authored C06 owner effect gate\n\nThe owner must be authorized and unpaused. Paid spend must remain zero. Unknown provider outcomes reconcile before a new write. An observed effect with verified receipt may be verified, while all other states remain held. Source changes never grant deploy authority; independent provider readback remains required.';

test('C06-01 owner/public/free CPU/source pin admission is mandatory',()=>{
 const value=admitC06(allowed);
 assert.equal(value.model,'onnx-community/Qwen2.5-Coder-1.5B-Instruct');
 assert.equal(value.revision,'774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf');
 assert.equal(value.paidBudgetCents,0);
 for(const item of [{actor:'attacker'},{repository:'other/repo'},{publicRepository:false},
  {paidBudgetCents:1},{paidBudgetCents:-1},{sourceSha:'main'},{issueNumber:244},
  {runner:'ubuntu-latest-gpu'}])
  assert.throws(()=>admitC06({...allowed,...item}),/c06-admission-denied/);
});

test('C06-02 independently scored code must implement all owner/stop/spend/unknown-write cases',()=>{
 assert.ok(C06_CASES.length>=12);
 const good=evaluateC06Function(functionSource);
 assert.equal(good.passed,true);
 assert.equal(good.correct,good.total);
 for(const unsafe of [
  'function fix(input) { return "verified"; }',
  'function fix(input) { return process.env.TOKEN; }',
  'function fix(input) { return input.constructor.constructor("return process")(); }',
  'function fix(input) { while(true) {} }',
  'function fix(input) { return "verified"; }\nprocess.exit(0);',
  'function fix(input) { return true; }\nfunction fix(input) { return true; }'
 ]){
  assert.equal(evaluateC06Function(unsafe).passed,false,unsafe);
 }
});

test('C06-03 only model-produced 3-file artifacts pass strict provenance and semantic checks',async()=>{
 const responses={source:functionSource,cases:tests,docs};
 const asked=[];
 const result=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12345',
  infer:async(kind,messages,attempt)=>{
   asked.push({kind,attempt,messages});
   return responses[kind];
  }
 });
 assert.deepEqual(asked.map(x=>x.kind),['source','cases','docs']);
 assert.ok(Object.keys(result.files).includes(C06_PATHS.source));
 assert.ok(Object.keys(result.files).includes(C06_PATHS.tests));
 assert.ok(Object.keys(result.files).includes(C06_PATHS.docs));
 assert.ok(Object.keys(result.files).includes(C06_PATHS.evidence));
 assert.equal(result.receipt.origin,'model-inference-not-assistant-authored');
 assert.equal(result.receipt.productionAccepted,false);
 assert.equal(result.receipt.modelRevision,admitC06(allowed).revision);
 assert.equal(verifyC06Files(result.files,{sourceSha:sha,runId:'12345'}).valid,true);
 assert.match(result.files[C06_PATHS.source],/export function fix\(input\)/);
 assert.match(result.files[C06_PATHS.tests],/generated/);
 assert.match(result.files[C06_PATHS.docs],/Unknown provider outcomes reconcile/);
});

test('C06-04 refuse generated test vectors that are vacuous or incorrect',async()=>{
 for(const bad of ['[]','{}','[{"expected":"verified"}]',JSON.stringify([
   {input:{authorized:false},expected:'verified'}])]){
   await assert.rejects(()=>buildC06Artifacts({
    admission:admitC06(allowed),runId:'12345',maxAttempts:1,
    infer:async kind=>({source:functionSource,cases:bad,docs})[kind]
   }),/c06-model-(?:cases|output)-rejected/);
 }
});

test('C06-05 fail closed on fake provenance, changed bytes or manipulated main SHA',async()=>{
 const result=await buildC06Artifacts({admission:admitC06(allowed),runId:'12345',
  infer:async kind=>({source:functionSource,cases:tests,docs})[kind]});
 for(const [path,value] of [
  [C06_PATHS.source,'export function fix(){return "verified";}'],
  [C06_PATHS.docs,'fake'],
  [C06_PATHS.evidence,'{}']
 ]) assert.throws(()=>verifyC06Files({...result.files,[path]:value},
   {sourceSha:sha,runId:'12345'}),/c06-provenance-invalid/);
 assert.throws(()=>verifyC06Files(result.files,{sourceSha:'b'.repeat(40),
  runId:'12345'}),/c06-provenance-invalid/);
});

test('C06-06 no deterministic substitution may rescue failed model output',async()=>{
 await assert.rejects(()=>buildC06Artifacts({
  admission:admitC06(allowed),runId:'12345',maxAttempts:2,
  infer:async kind=>kind==='source'?'function fix(input) { return "verified"; }':
   kind==='cases'?tests:docs,
 }),/c06-model-source-rejected/);
});

test('C06-07 workflow separates read-only inference from write-capable publishing',async()=>{
 const file=await readFile(new URL('../.github/workflows/c06-owner-model-release.yml',import.meta.url),'utf8');
 assert.match(file,/workflow_dispatch:/);
 assert.match(file,/runs-on:\s*ubuntu-24\.04/);
 assert.match(file,/node scripts\/c06-run-model\.mjs/);
 assert.match(file,/node scripts\/c06-verify-output\.mjs/);
 assert.match(file,/needs:\s*generate/);
 assert.match(file,/permissions:\s*\n\s*contents:\s*read/);
 assert.match(file,/pull-requests:\s*write/);
 assert.doesNotMatch(file,/^\s+schedule:/m);
 assert.doesNotMatch(file,/OPENAI_API_KEY|HF_TOKEN|jobs\.huggingface|gpu-/i);
});

test('C06-08 published verifier must not execute untrusted source under write token',async()=>{
 const file=await readFile(new URL('../scripts/c06-verify-output.mjs',import.meta.url),'utf8');
 assert.match(file,/verifyC06Files/);
 assert.doesNotMatch(file,/import\s*\(.*c06-model-candidate|vm\.run|execSync\(/);
});
