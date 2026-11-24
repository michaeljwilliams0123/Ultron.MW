import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as gate from '../src/council-trusted-gate.mjs';

const SHA='a'.repeat(40),BASE='b'.repeat(40);
const RUN_ID=388875616,REPO_ID=1424939667;
function completeRun(){
 return {action:'completed',workflow_run:{
  workflow_id:RUN_ID,event:'pull_request',status:'completed',
  conclusion:'success',head_sha:SHA,
  // run-name is a PR title, NOT the configured workflow display name.
  name:'fix(ci): change Council timing',
  head_repository:{id:REPO_ID,full_name:'michaeljwilliams0123/Ultron.MW'},
  pull_requests:[{number:464,head:{sha:SHA,repo:{id:REPO_ID}},
   base:{sha:BASE,ref:'main',repo:{id:REPO_ID}}}]
 }};
}
function check(name,{result='success',status='completed',
 started_at='2026-11-16T20:30:00Z',sha=SHA,app=15368}={}){
 return {name,conclusion:result,status,started_at,head_sha:sha,app:{id:app}};
}
const REQUIRED=['test','fixed-comparison','reef-runtime-probe','attested-receipt'];
function completeChecks(){return{total_count:4,check_runs:REQUIRED.map(name=>check(name))};}

test('completed trusted core PR run resolves the exact pull request number',()=>{
 const event=completeRun();
 assert.equal(gate.selectCouncilTargetNumber('workflow_run',event),464);
});
test('reject malformed, incomplete, foreign, stale and duplicate workflow run targets',()=>{
 const modifications=[
  p=>{p.action='in_progress'},
  p=>{p.workflow_run.workflow_id=111},
  p=>{p.workflow_run.event='push'},
  p=>{p.workflow_run.conclusion='failure'},
  p=>{p.workflow_run.status='in_progress'},
  p=>{p.workflow_run.head_repository.id=123},
  p=>{p.workflow_run.head_sha='c'.repeat(40)},
  p=>{p.workflow_run.pull_requests=[]},
  p=>{p.workflow_run.pull_requests.push({...p.workflow_run.pull_requests[0],number:999})},
  p=>{p.workflow_run.pull_requests[0].head.sha='d'.repeat(40)},
  p=>{p.workflow_run.pull_requests[0].head.repo.id=123},
  p=>{p.workflow_run.pull_requests[0].base.ref='other'},
  p=>{p.workflow_run.pull_requests[0].base.repo.id=123},
  p=>{p.workflow_run.pull_requests[0].number='0464'}
 ];
 for(const modify of modifications){
  const p=completeRun();modify(p);
  assert.equal(gate.selectCouncilTargetNumber('workflow_run',p),null,
   JSON.stringify(p));
 }
});
test('exact-head Council evidence remains pending until every required CI and attestation check completes',()=>{
 assert.equal(typeof gate.councilExactHeadCiReady,'function');
 const okay=completeChecks();
 assert.equal(gate.councilExactHeadCiReady(okay,SHA),true);
 assert.equal(gate.councilExactHeadCiReady({total_count:0,check_runs:[]},SHA),false);
 for(const name of REQUIRED){
  const pending=completeChecks();
  pending.check_runs.find(c=>c.name===name).status='in_progress';
  pending.check_runs.find(c=>c.name===name).conclusion=null;
  assert.equal(gate.councilExactHeadCiReady(pending,SHA),false,name+' pending');
  const failed=completeChecks();
  failed.check_runs.find(c=>c.name===name).conclusion='failure';
  assert.equal(gate.councilExactHeadCiReady(failed,SHA),false,name+' failed');
  const removed=completeChecks();
  removed.check_runs=removed.check_runs.filter(c=>c.name!==name);
  removed.total_count=3;
  assert.equal(gate.councilExactHeadCiReady(removed,SHA),false,name+' missing');
 }
 for(const override of [{head_sha:BASE},{app:{id:2}},{conclusion:'skipped'}]){
  const wrong=completeChecks();Object.assign(wrong.check_runs[0],override);
  assert.equal(gate.councilExactHeadCiReady(wrong,SHA),false,JSON.stringify(override));
 }
 assert.equal(gate.councilExactHeadCiReady({total_count:101,check_runs:okay.check_runs},SHA),false);
 const superseded=completeChecks();
 superseded.check_runs.unshift(check('test',{status:'in_progress',result:null,started_at:'2026-11-16T21:00:00Z'}));
 superseded.total_count=5;
 assert.equal(gate.councilExactHeadCiReady(superseded,SHA),false,
  'latest in-progress check outranks older success on the same head');
});
test('trusted Council workflow waits for completed core CI without loading untrusted PR code',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
 assert.match(yaml,/workflow_run:\s*\n\s*workflows:\s*\["Ultron core verification", "Ultron ops audit lane", "Ultron Council Multi-Agent Debate Loop"\]\s*\n\s*types:\s*\[completed\]/);
 assert.match(yaml,/github\.event\.workflow_run\.workflow_id == 388875616/);
 assert.match(yaml,/gate\.councilExactHeadCiReady\(checks\.data,pr\.head\.sha\)/);
 assert.match(yaml,/Council CI incomplete; deferring Gate App decision/);
 assert.match(yaml,/github\.event\.workflow_run\.event == 'pull_request'/);
 assert.match(yaml,/github\.event\.workflow_run\.conclusion == 'success'/);
 assert.match(yaml,/ref: main\s*\n\s*persist-credentials: false/);
 assert.match(yaml,/github-token: \$\{\{ steps\.app\.outputs\.token \}\}/);
});

test('automatic CI completion never executes the Coordinator PR-comment side effect',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
 const effect=yaml.split('- name: Execute one real Coordinator PR COMMENT review')[1]
  ?.split('- name: Retain Council execution evidence')[0];
 assert.ok(effect,'effectful Coordinator step must remain separately gated');
 assert.match(effect,/steps\.prepare\.outputs\.skip == 'false'/);
 assert.match(effect,/github\.event_name != 'workflow_run'/,
  'the automatic post-CI check must not dispatch a new GitHub comment');
 assert.match(effect,/env\.OWNER_MODE == '1'/);
 assert.match(yaml,/name: Publish check run as the Council Gate App/,
  'post-CI status publisher must remain functional');
});
