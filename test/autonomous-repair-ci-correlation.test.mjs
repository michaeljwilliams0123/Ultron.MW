import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {observeVerifyRun,dispatchAndObserveVerify} from '../src/pr-brain-verify.mjs';
import {createAutonomousRepairGitHubAdapters} from '../src/autonomous-repair-github-adapter.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const branch='ultron/repair-ci-correlation-001';
const sha='a'.repeat(40);
const fp='e'.repeat(64);
const correlation='repair-'+fp+'-1';
const run=(id,display_title='Ultron core verification')=>({
 id,name:'Ultron core verification',path:'.github/workflows/verify.yml',
 event:'workflow_dispatch',display_title,
 head_branch:branch,head_sha:sha,
 head_repository:{full_name:'michaeljwilliams0123/Ultron.MW'},
 status:'completed',conclusion:'success',run_attempt:1
});
function provider(runs){
 const calls=[],get=async path=>{
  calls.push(path);
  if(path.startsWith(ROOT+'/actions/runs?'))return {total_count:runs.length,workflow_runs:runs};
  const id=Number(path.split('/').at(-1));
  if(path.startsWith(ROOT+'/actions/runs/')&&runs.find(x=>x.id===id))return runs.find(x=>x.id===id);
  throw Error('unknown read '+path);
 };
 return {calls,get};
}
test('old green run on the same branch/SHA cannot verify a new repair attempt',async()=>{
 const p=provider([run(100)]);
 const result=await observeVerifyRun({get:p.get,branch,headSha:sha,correlation});
 assert.equal(result.state,'pending');
 assert.equal(result.conclusion,null);
});
test('unrelated dispatch markers cannot impersonate an exact repair attempt',async()=>{
 const p=provider([run(104,'Ultron repair repair-'+fp+'-2'),
  run(103,'Ultron repair repair-'+'f'.repeat(64)+'-1')]);
 const result=await observeVerifyRun({get:p.get,branch,headSha:sha,correlation});
 assert.equal(result.state,'pending');
});
test('only a matching exact-head, exact-marker, independently read-back CI run passes',async()=>{
 const expected=run(112,'Ultron repair '+correlation);
 const p=provider([run(100),expected]);
 const observed=await observeVerifyRun({get:p.get,branch,headSha:sha,correlation});
 assert.equal(observed.state,'completed');
 assert.equal(observed.runId,112);
 assert.equal(observed.sha,sha);
 assert.ok(p.calls.some(x=>x===ROOT+'/actions/runs/112'));
});
test('dispatch carries task correlation as structured input without shell interpolation',async()=>{
 const posts=[];let calls=0;
 const expected=run(113,'Ultron repair '+correlation);
 const p=provider([run(100),expected]);
 const get=async path=>{
  if(path.startsWith(ROOT+'/actions/runs?'))return {total_count:++calls,workflow_runs:calls===1?[run(100)]:[expected]};
  return p.get(path);
 };
 const observed=await dispatchAndObserveVerify({get,post:async(path,payload)=>{
  posts.push({path,payload});return {};
 },branch,headSha:sha,correlation,maxPolls:1,intervalMs:0});
 assert.equal(observed.state,'completed');
 assert.deepEqual(posts[0].payload,{ref:branch,inputs:{repair_correlation:correlation}});
});
test('adapter derives the correlation from immutable task fingerprint and attempt',async()=>{
 const p=provider([run(100)]);
 const adapter=createAutonomousRepairGitHubAdapters({
  get:p.get,post:async()=>({}),updateRef:async()=>{}
 });
 const task={fingerprint:fp,branch,objective:'Fix CI handoff'};
 const old=await adapter.verifier.observe({plan:task,attempt:1,headSha:sha});
 assert.equal(old.state,'pending');
 const expected=run(114,'Ultron repair '+correlation);
 p.get=async path=>path.startsWith(ROOT+'/actions/runs?')?
  {total_count:2,workflow_runs:[run(100),expected]}:expected;
 const next=createAutonomousRepairGitHubAdapters({
  get:p.get,post:async()=>({}),updateRef:async()=>{}
 });
 assert.equal((await next.verifier.observe({plan:task,attempt:1,headSha:sha})).runId,114);
});
test('workflow actually exposes correlation input and run-name for GitHub API display_title',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
 assert.match(yaml,/run-name:.*repair_correlation/);
 assert.match(yaml,/workflow_dispatch:\s+inputs:\s+repair_correlation:/);
});


test('ordinary PR/push CI retains descriptive run titles outside repair dispatches',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
 assert.match(yaml,/github\.event\.pull_request\.title/);
 assert.match(yaml,/github\.event\.head_commit\.message/);
});
