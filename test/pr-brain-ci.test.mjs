import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reportCiToPr,verifiedCiReceipt} from '../src/pr-brain-ci.mjs';

const REPO='michaeljwilliams0123/Ultron.MW', ROOT='/repos/'+REPO;
const SHA='a'.repeat(40),OTHER='b'.repeat(40);
const run={id:901,status:'completed',name:'Ultron core verification',
  conclusion:'success',event:'workflow_dispatch',head_sha:SHA,
  head_branch:'ultron/self-scan-abc',head_repository:{full_name:REPO},
  path:'.github/workflows/verify.yml',run_attempt:1};
const pr={number:24,state:'open',head:{sha:SHA,ref:run.head_branch,
  repo:{full_name:REPO}},base:{ref:'main',repo:{full_name:REPO}}};
function fixture(options={}){
  const state={comments:[],posts:[],run:{...run,...options.run},
    pr:{...pr,head:{...pr.head,sha:options.head??SHA}},id:800};
  const get=async path=>{
    if(path===ROOT+'/actions/runs/901')return state.run;
    if(path===ROOT+'/pulls?state=open&per_page=100')return [state.pr];
    if(path===ROOT+'/pulls/24')return state.pr;
    if(path.startsWith(ROOT+'/issues/24/comments?'))return state.comments;
    if(path.startsWith(ROOT+'/issues/comments/'))return state.comments.find(x=>x.id===Number(path.split('/').at(-1)));
    throw Error('Unexpected read '+path);
  };
  const post=async(path,body)=>{
    state.posts.push({path,body});
    assert.equal(path,ROOT+'/issues/24/comments');
    const c={id:++state.id,user:{login:'github-actions[bot]'},body:body.body};
    state.comments.push(c);return {id:c.id};
  };
  const invoke=()=>reportCiToPr({repository:REPO,
    event:{action:'completed',workflow_run:{id:901,head_sha:state.run.head_sha,
      conclusion:state.run.conclusion}},get,post});
  return {state,invoke};
}
test('CI feedback verifies terminal GitHub result, exact PR head and posts one receipt',async()=>{
  const f=fixture();
  const result=await f.invoke();
  assert.equal(result.result,'success');
  assert.equal(result.prNumber,24);
  assert.match(f.state.comments[0].body,/Result: \*\*success\*\*/);
  assert.match(f.state.comments[0].body,/actions\/runs\/901/);
  assert.match(f.state.comments[0].body,/production-runtime readiness/);
  const again=await f.invoke();
  assert.equal(again.status,'already-reported');
  assert.equal(f.state.posts.length,1);
});
test('source moved after verification: mark stale, never successful',async()=>{
  const f=fixture({head:OTHER});
  const r=await f.invoke();
  assert.equal(r.result,'stale');
  assert.match(f.state.comments[0].body,/Result: \*\*stale\*\*/);
  assert.doesNotMatch(f.state.comments[0].body,/Result: \*\*success\*\*/);
});
test('failed and action_required conclusions are relayed truthfully',async()=>{
  for(const conclusion of ['failure','action_required']){
    const f=fixture({run:{conclusion}});
    const r=await f.invoke();
    assert.equal(r.result,conclusion);
    assert.match(f.state.comments[0].body,new RegExp('Result: \\*\\*'+conclusion+'\\*\\*'));
  }
});
test('malformed or spoofed Verify runs fail before any PR comment',async()=>{
  for(const wrong of [
    {name:'Other workflow'},
    {head_repository:{full_name:'outsider/project'}},
    {path:'.github/workflows/other.yml'},
    {status:'in_progress'},
    {event:'push'},
    {run_attempt:0},
    {head_sha:'invalid'},
  ]){
    const f=fixture({run:wrong});
    await assert.rejects(()=>f.invoke(),/trusted terminal/);
    assert.equal(f.state.posts.length,0);
  }
  const f=fixture();
  assert.throws(()=>verifiedCiReceipt({run:{...run,conclusion:'pending'},pr,status:'current'}),/trusted terminal/);
});
test('trusted main workflow observes verification completion, without checkout from PR',async()=>{
  const text=await readFile(new URL('../.github/workflows/pr-brain-ci.yml',import.meta.url),'utf8');
  assert.match(text,/workflow_run:/);
  assert.match(text,/types: \[completed\]/);
  assert.match(text,/ref: main/);
  assert.match(text,/run: node src\/pr-brain-ci\.mjs/);
  assert.doesNotMatch(text,/pull_request_target/);
});
