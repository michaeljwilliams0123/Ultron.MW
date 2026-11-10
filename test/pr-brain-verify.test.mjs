import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchAndObserveVerify} from '../src/pr-brain-verify.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
const BRANCH='ultron/self-scan-abc',SHA='a'.repeat(40);
const URL=ROOT+'/actions/runs?branch='+encodeURIComponent(BRANCH)+'&per_page=30';
const run={id:105,name:'Ultron core verification',path:'.github/workflows/verify.yml',
  event:'workflow_dispatch',head_branch:BRANCH,head_sha:SHA,
  head_repository:{full_name:'michaeljwilliams0123/Ultron.MW'},
  status:'completed',conclusion:'success',run_attempt:1};
test('original PR-comment job independently detects new successful exact-head Verify',async()=>{
  let calls=0;const posts=[];let count=0;
  const get=async path=>{
    if(path===URL)return {total_count:count++,workflow_runs:calls++<2?[{...run,id:100}]:[run]};
    if(path===ROOT+'/actions/runs/105')return run;
    throw Error('unexpected '+path);
  };
  const out=await dispatchAndObserveVerify({get,
    post:async(path,b)=>{posts.push([path,b]);return {};},
    branch:BRANCH,headSha:SHA,maxPolls:4,intervalMs:0,sleep:async()=>{}});
  assert.equal(out.state,'completed');
  assert.equal(out.conclusion,'success');
  assert.equal(out.runId,105);
  assert.equal(posts.length,1);
});
test('no fresh authenticated Verify means pending, not success',async()=>{
  const get=async()=>({total_count:1,workflow_runs:[{...run,id:100}]});
  const result=await dispatchAndObserveVerify({get,post:async()=>({}),branch:BRANCH,
    headSha:SHA,maxPolls:3,intervalMs:0,sleep:async()=>{}});
  assert.equal(result.state,'pending');
  assert.equal(result.conclusion,null);
});
test('spoofed source branch, SHA and run mismatches never confirm a pass',async()=>{
  let n=0;const get=async path=>{
    if(path===URL)return {total_count:1,workflow_runs:n++?[{...run,head_sha:'b'.repeat(40)}]:[]};
    throw Error('unexpected '+path);
  };
  const result=await dispatchAndObserveVerify({get,post:async()=>({}),branch:BRANCH,
    headSha:SHA,maxPolls:2,intervalMs:0,sleep:async()=>{}});
  assert.equal(result.state,'pending');
});
