import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectCouncilTargetNumber} from '../src/council-trusted-gate.mjs';
const SHA='a'.repeat(40),BASE='b'.repeat(40),REPO=1424939667;
const pr={number:546,head:{sha:SHA,repo:{id:REPO}},base:{sha:BASE,ref:'main',repo:{id:REPO}}};
function event(id){return {action:'completed',workflow_run:{workflow_id:id,event:'pull_request',status:'completed',conclusion:'success',head_repository:{id:REPO},head_sha:SHA,pull_requests:[pr]}}}
test('last successful prerequisite workflow can wake the trusted gate',()=>{
 for(const id of [388875616,414195978,401204437])assert.equal(selectCouncilTargetNumber('workflow_run',event(id)),546);
});
test('untrusted or ambiguous completions never wake the gate',()=>{
 for(const id of [414195978,401204437])for(const mutate of [
  e=>{e.workflow_run.head_repository.id=7},e=>{e.workflow_run.head_sha=BASE},
  e=>{e.workflow_run.pull_requests=[]},e=>{e.workflow_run.pull_requests=[pr,pr]},
  e=>{e.workflow_run.conclusion='failure'},e=>{e.workflow_run.event='push'}
 ]){const e=structuredClone(event(id));mutate(e);assert.equal(selectCouncilTargetNumber('workflow_run',e),null);}
 assert.equal(selectCouncilTargetNumber('workflow_run',event(999999)),null);
});
test('trusted workflow listens for all pinned prerequisite completions, without candidate execution',()=>{
 const y=readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
 assert.match(y,/workflows: \["Ultron core verification", "Ultron ops audit lane", "Ultron Council Multi-Agent Debate Loop"\]/);
 for(const id of [388875616,414195978,401204437])assert.ok(y.includes('workflow_run.workflow_id == '+id));
 assert.match(y,/ref: main/);
 assert.match(y,/gate\.councilExactHeadCiReady\(checks\.data,pr\.head\.sha\)/);
});
