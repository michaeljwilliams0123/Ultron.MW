import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateWorkflowEvidence,CORE_VERIFY_WORKFLOW} from '../src/ci-evidence.mjs';
const SHA='a'.repeat(40);
const good={id:43,workflow_id:388875616,path:'.github/workflows/verify.yml',
 name:'arbitrary commit title',head_sha:SHA,head_branch:'main',
 head_repository:{full_name:'michaeljwilliams0123/Ultron.MW'},
 event:'push',status:'completed',conclusion:'success',run_attempt:1};
const jobs={total_count:2,jobs:[
 {name:'test',status:'completed',conclusion:'success',run_attempt:1},
 {name:'attested-receipt',status:'completed',conclusion:'success',run_attempt:1}
]};
test('CI-01 accepts verified exact-main CI independent of display name',()=>{
 const x=evaluateWorkflowEvidence({runs:[good],jobsByRunId:{43:jobs},targetSha:SHA});
 assert.equal(x.verified,true);assert.equal(x.status,'verified');
 assert.deepEqual(CORE_VERIFY_WORKFLOW.requiredJobs.push,['test','attested-receipt']);
});
test('CI-02 rejects display-name collision and wrong workflow identity',()=>{
 for(const changed of [{path:'.github/workflows/dummy.yml'},
 {workflow_id:123},{head_sha:'b'.repeat(40)},{head_branch:'other'},
 {head_repository:{full_name:'attacker/repo'}}]){
  assert.equal(evaluateWorkflowEvidence({runs:[{...good,...changed}],jobsByRunId:{43:jobs},targetSha:SHA}).verified,false);
 }
});
test('CI-03 cannot count skipped, missing, cross-attempt, or duplicate jobs',()=>{
 for(const payload of [
  {total_count:0,jobs:[]},{total_count:2,jobs:[...jobs.jobs.slice(0,1)]},
  {total_count:2,jobs:[...jobs.jobs.slice(0,1),{...jobs.jobs[1],conclusion:'skipped'}]},
  {total_count:2,jobs:[...jobs.jobs.slice(0,1),{...jobs.jobs[1],run_attempt:2}]},
  {total_count:2,jobs:[jobs.jobs[0],jobs.jobs[0]]}
 ])assert.equal(evaluateWorkflowEvidence({runs:[good],jobsByRunId:{43:payload},targetSha:SHA}).verified,false);
});
test('CI-04 distinguishes absent, in-progress and definite failure',()=>{
 assert.equal(evaluateWorkflowEvidence({runs:[],targetSha:SHA}).status,'pending-or-absent');
 assert.equal(evaluateWorkflowEvidence({runs:[{...good,status:'in_progress'}],targetSha:SHA}).status,'in-progress');
 assert.equal(evaluateWorkflowEvidence({runs:[{...good,conclusion:'failure'}],jobsByRunId:{43:jobs},targetSha:SHA}).status,'failed');
});
test('CI-05 keeps Node and Hatchable mirrors byte-identical',()=>{
 const node=readFileSync(new URL('../src/ci-evidence.mjs',import.meta.url),'utf8');
 const hatch=readFileSync(new URL('../cloud/hatchable/lib/ci-evidence.js',import.meta.url),'utf8');
 assert.equal(node,hatch);
});
