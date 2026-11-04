import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeVerifiedWorkflow} from '../cloud/hatchable/lib/hf-github-receipts.js';
const SHA='a'.repeat(40),OTHER='b'.repeat(40),ID=41775191071;
const base=()=>({
 schema:'ultron.hf-lab.v1',
 workflows:[{key:'c06',state:'observed',runId:ID,status:'completed',
   conclusion:'success',headSha:SHA,observation:undefined,
   runUrl:'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/'+ID}],
 benchmark:{models:[{key:'coder-large',productionEligible:false,
   approvedUse:'noncommercial-evaluation-only'}]},
 release:{productionAccepted:false,autoPromotion:false}
});
const row=(changes={})=>({
 workflow_key:'c06',run_id:ID,run_attempt:1,
 source_sha:SHA,conclusion:'success',state:'verified',
 github_verified_at:'2026-11-04T05:00:00.000Z',
 artifacts:[{id:13295973797,name:'c06-model-output-41775191071'}],
 ...changes
});
test('HF-OVERLAY-01: same-run independently verified receipt enriches existing cached outcome',()=>{
 const result=mergeVerifiedWorkflow(base(),[row()]);
 assert.equal(result.workflows[0].observation,'signed-webhook+github-readback');
 assert.equal(result.workflows[0].artifactsObserved,1);
 assert.equal(result.workflows[0].runId,ID);
 assert.equal(result.release.productionAccepted,false);
 assert.equal(result.benchmark.models[0].productionEligible,false);
});
test('HF-OVERLAY-02: same-run conflicting SHA or conclusion never overrides cached source',()=>{
 for(const patch of [{source_sha:OTHER},{conclusion:'failure'}]){
  const result=mergeVerifiedWorkflow(base(),[row(patch)]);
  assert.equal(result.workflows[0].observation,undefined);
  assert.equal(result.workflows[0].conclusion,'success');
  assert.equal(result.workflows[0].artifactsObserved,undefined);
 }
});
test('HF-OVERLAY-03: old verified receipt cannot replace a newer cached workflow',()=>{
 const result=mergeVerifiedWorkflow(base(),[row({run_id:ID-1})]);
 assert.equal(result.workflows[0].runId,ID);
 assert.equal(result.workflows[0].observation,undefined);
});
test('HF-OVERLAY-04: genuinely newer verified source can supersede a stale cached result',()=>{
 const snapshot=base();
 snapshot.workflows[0].runId=ID-1;
 snapshot.workflows[0].headSha=OTHER;
 snapshot.workflows[0].conclusion='failure';
 const result=mergeVerifiedWorkflow(snapshot,[row()]);
 assert.equal(result.workflows[0].runId,ID);
 assert.equal(result.workflows[0].observation,'signed-webhook+github-readback');
 assert.equal(result.workflows[0].conclusion,'success');
});
