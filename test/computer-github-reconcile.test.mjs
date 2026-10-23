import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createComputerExecutor, createMemoryComputerStore, normalizeComputerPlan } from '../src/computer/executor.mjs';
import { reconcileGithubCommentCheckpoint } from '../src/computer/github-comment-reconcile.mjs';

const origin = 'https://github.com';
const owner = 'michaeljwilliams0123';
const marker = 'ULTRON_BROWSER_WRITE_CANARY_PR85_20261022_B';
const message = marker + ': This is a non-sensitive Ultron owner-approved isolated Chrome comment for live browser-write acceptance. Verify independently via GitHub API.';
const plan = { id:'owner-github-live-write-pr85-20261022-b', steps:[
  {id:'open-github-login',action:'navigate',url:origin+'/login',expect:{urlIncludes:'/login'}},
  {id:'authenticated-profile',action:'navigate',url:origin+'/settings/profile',expect:{urlIncludes:'/settings/profile'}},
  {id:'open-canary-pr',action:'navigate',url:origin+'/'+owner+'/Ultron.MW/pull/85',expect:{urlIncludes:'/pull/85'}},
  {id:'owner-approved-compose',action:'type',selector:'textarea#new_comment_field:visible',value:message,expect:{urlIncludes:'/pull/85'}},
  {id:'owner-approved-publish',action:'click',selector:'button[type="submit"]:has-text("Comment")',expect:{textIncludes:marker}},
]};
const allowedOrigins = [origin];
const digest = value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const githubComment = {id:6357408672,body:message,created_at:'2026-10-23T04:30:05Z',
  html_url:origin+'/'+owner+'/Ultron.MW/pull/85#issuecomment-6357408672',user:{login:owner}};
function fixture() {
  const store = createMemoryComputerStore();
  const normalized=normalizeComputerPlan(plan,{allowedOrigins});
  const initial={id:plan.id,fingerprint:digest(normalized),status:'reconcile-required',
    pending:'owner-approved-publish',completed:plan.steps.slice(0,-1).map(s=>s.id),
    createdAt:'2026-10-23T04:28:18.841Z',
    errorCode:'outcome-unverified',failurePhase:'postcondition-verification',
    receipts:plan.steps.slice(0,-1).map(s=>({
      stepId:s.id,action:s.action,status:'verified',
      observedAt:s.action==='type'?'2026-10-23T04:29:32.808Z':'2026-10-23T04:29:14.430Z',
    }))};
  return {store,initial};
}
async function readback(overrides={}) {
  const {store,initial}=fixture();
  await store.write(plan.id,initial);
  let count=0;
  const opts={plan,allowedOrigins,store,ownerLogin:owner,
    readComments: async()=>{count++;return [githubComment];},...overrides};
  return {store,initial,opts,get count(){return count;}};
}

test('confirmed exact GitHub comment reconciles original pending publish without dispatch',async()=>{
  const h=await readback();
  const result=await reconcileGithubCommentCheckpoint(h.opts);
  assert.equal(result.status,'completed');
  assert.equal(result.reconciliation.commentId,6357408672);
  const checkpoint=await h.store.read(plan.id);
  assert.equal(checkpoint.pending,null);
  assert.equal(checkpoint.receipts.length,plan.steps.length);
  assert.equal(checkpoint.reconciliation.previousFailurePhase,'postcondition-verification');
  assert.equal(JSON.stringify(checkpoint).includes(message),false);
  assert.equal(h.count,1);
  let dispatches=0;
  const executor=createComputerExecutor({store:h.store,allowedOrigins,authorize:async()=>true,
    driver:{observe:async()=>{throw Error('Should not observe');},
      perform:async()=>{dispatches++;throw Error('Should not execute');}}});
  const replay=await executor.run(plan);
  assert.equal(replay.status,'completed');
  assert.equal(replay.resumed,true);
  assert.equal(dispatches,0);
  const second=await reconcileGithubCommentCheckpoint(h.opts);
  assert.equal(second.status,'completed');
  assert.equal(h.count,1);
});

test('missing, mismatched, duplicate, wrong-author, or stale evidence keeps pending and never replays',async()=>{
  for(const comments of [
    [],[{...githubComment,body:'Not this exact write'}],
    [githubComment,{...githubComment,id:6357408673}],
    [{...githubComment,user:{login:'different-account'}}],
    [{...githubComment,created_at:'2026-10-23T04:20:05Z'}],
    [{...githubComment,id:0}],
  ]){
    const h=await readback({readComments:async()=>comments});
    const result=await reconcileGithubCommentCheckpoint(h.opts);
    assert.equal(result.status,'reconcile-required');
    assert.deepEqual(await h.store.read(plan.id),h.initial);
  }
});

test('readback failure, stale plan fingerprint, and wrong expected owner all fail closed',async()=>{
  const broken=await readback({readComments:async()=>{throw Error('github unavailable');}});
  assert.equal((await reconcileGithubCommentCheckpoint(broken.opts)).status,'reconcile-required');
  assert.deepEqual(await broken.store.read(plan.id),broken.initial);
  const changed=await readback({ownerLogin:'other'});
  await assert.rejects(reconcileGithubCommentCheckpoint(changed.opts),/owner|scope/i);
  assert.deepEqual(await changed.store.read(plan.id),changed.initial);
  const altered=await readback({plan:{...plan,steps:plan.steps.map(s=>
    s.action==='type'?{...s,value:s.value+'!'}:s)}});
  await assert.rejects(reconcileGithubCommentCheckpoint(altered.opts),/fingerprint/i);
});

test('read-only post-click observation can confirm delayed render without a second dispatch',async()=>{
  const store=createMemoryComputerStore();
  const p={id:'late-ui-change',steps:[{id:'publish',action:'click',selector:'#submit',
    expect:{textIncludes:'Published'}}]};
  let observations=0,dispatches=0;
  const result=await createComputerExecutor({store,allowedOrigins,
    authorize:async()=>true,driver:{
      observe:async()=>{
        observations++;
        return {url:origin+'/'+owner+'/Ultron.MW/pull/85',title:'Conversation',
          text:observations>2?'Published':'Before'};
      },
      preflight:async()=>true,
      perform:async()=>{dispatches++;},
    }}).run(p);
  assert.equal(result.status,'completed');
  assert.equal(dispatches,1);
  assert.ok(observations>=3);
});
