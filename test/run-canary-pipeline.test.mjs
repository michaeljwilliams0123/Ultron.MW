import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanaryCommitOperation,runMasterPipeline}
  from '../scripts/run-canary-pipeline.mjs';

const SHA='0123456789abcdef0123456789abcdef01234567';
const COMMIT='a'.repeat(40);
const TREE='b'.repeat(40);
const BRANCH='ultron/canary-smoke-test';
const params={taskId:'smoke-test-01',objective:'Verify one branch',
  sourceSha:SHA,branch:BRANCH};
const plan={schema:'ultron.github.operation.v1',
  repository:'michaeljwilliams0123/Ultron.MW',operation:'repair.branch.create',
  activeAgentRole:'Builder',idempotencyKey:'repair:smoke-test-01',
  permittedScope:{operation:'repair.branch.create',repositoryId:1424939667,
    permissions:{metadata:'read',contents:'write'}},parameters:params};
const request={signedGrant:{nonce:'unique-nonce'},nonce:'unique-nonce',
  signature:'authentic-ecdsa-signature',activeAgentRole:'Builder',payload:plan};
const durableServices={db:{query:async()=>({rows:[]})},
  authorization:{verify:async()=>({verified:true})}};
const marker=d=>'Ultron-Operation-Digest: '+d;
function stages(overrides={}){
  const deps={
    createVerifiedGitHubClient:async()=>({installationId:42,
      getTokenForScope:async operation=>({token:'ephemeral-token',operation})}),
    enforceSignedApprovalAndTagPersona:async(_request,factory)=>{
      const issued=await factory.getTokenForScope({operation:'repair.branch.create'});
      assert.equal(issued.operation,'repair.branch.create');
      return {authorized:true,token:'ephemeral-token',
        persona:{role:'Builder',authorName:'Ultron Builder',authorEmail:'builder@example.invalid'},
        executionPayload:{...plan,parameters:{...params}}};
    },
    dispatchHeadlessTask:async(_objective,context)=>({...context,stage:'prepared'}),
    executeIdempotentGitHubWrite:async(context,token,persona,operation)=>{
      assert.equal(persona.role,'builder');
      const result=await operation({token,persona,
        targetBranch:context.targetBranch,
        operationDigest:context.operationDigest,
        operationMarker:marker(context.operationDigest)});
      return {idempotencyKey:'ultron-task-'+context.taskId,status:'success',
        details:{branch:result.branch,sha:result.sha,
          operationDigest:context.operationDigest,remoteVerified:true}};
    },
    verifyPostConditionsAndStoreReceipt:async receipt=>({
      schema:'ultron.task5.local-audit.v1',
      idempotencyKey:receipt.idempotencyKey,executionStatus:receipt.status,
      status:'REMOTE_READBACK_REQUIRED',remoteReadbackVerified:false,
      auditSha256:'a'.repeat(64),executionReceiptDigest:'b'.repeat(64)}),
    gitOperation:async ({targetBranch,operationDigest})=>({
      branch:targetBranch,sha:COMMIT,operationDigest,
    }),durableServices,
  };
  deps.dispatchHeadlessTask.supportsPrepareOnly=true;
  return {...deps,...overrides};
}

test('conductor verifies five signed handoffs with remote receipt and local audit distinct',async()=>{
  const result=await runMasterPipeline(request,stages());
  assert.equal(result.status,'remote-verified');
  assert.equal(result.productionAccepted,false);
  assert.equal(result.commitSha,COMMIT);
  assert.equal(result.auditStatus,'REMOTE_READBACK_REQUIRED');
  assert.ok(!JSON.stringify(result).includes('ephemeral-token'));
});

test('untrusted grant, role and operation fail before identity or remote write',async()=>{
  let invoked=false;
  const deps=stages({createVerifiedGitHubClient:async()=>{invoked=true;}});
  await assert.rejects(runMasterPipeline({...request,signature:''},deps),
    /canary-signed-grant-required/);
  await assert.rejects(runMasterPipeline({...request,payload:{...plan,
    operation:'repository.settings.update'}},deps),/canary-signed-plan-invalid/);
  assert.equal(invoked,false);
});

test('signed scope cannot be replaced by interceptor or dispatcher',async()=>{
  await assert.rejects(runMasterPipeline(request,stages({
    enforceSignedApprovalAndTagPersona:async()=>({authorized:true,
      token:'ephemeral-token',persona:{role:'Builder'},
      executionPayload:{...plan,parameters:{...params,branch:'ultron/canary-other'}}})
  })),/canary-authorization-payload-mismatch/);
  const swapped=async()=>({stage:'prepared',taskId:'other',
    sourceSha:SHA,targetBranch:BRANCH,operationDigest:'f'.repeat(64)});
  swapped.supportsPrepareOnly=true;
  await assert.rejects(runMasterPipeline(request,stages({dispatchHeadlessTask:swapped})),
    /canary-dispatcher-context-mismatch/);
});

test('old dispatcher is refused before it invokes any graph',async()=>{
  let called=0;
  await assert.rejects(runMasterPipeline(request,stages({
    dispatchHeadlessTask:async()=>{called++;}
  })),/canary-dispatcher-prepare-contract-required/);
  assert.equal(called,0);
});

test('Task 4 must return exact operation digest and verified remote SHA',async()=>{
  let audited=false;
  await assert.rejects(runMasterPipeline(request,stages({
    executeIdempotentGitHubWrite:async()=>({
      idempotencyKey:'ultron-task-smoke-test-01',status:'success',
      details:{branch:BRANCH,sha:COMMIT,operationDigest:'f'.repeat(64),remoteVerified:true}
    }),verifyPostConditionsAndStoreReceipt:async()=>{audited=true;}
  })),/canary-execution-receipt-unverified/);
  assert.equal(audited,false);
});

test('Task 5 local artifact is not misreported as remote evidence',async()=>{
  await assert.rejects(runMasterPipeline(request,stages({
    verifyPostConditionsAndStoreReceipt:async()=>({schema:'ultron.task5.local-audit.v1',
      idempotencyKey:'ultron-task-smoke-test-01',executionStatus:'success',
      status:'LOCAL_DIFF_VERIFIED_REMOTE_UNVERIFIED',remoteReadbackVerified:false,
      auditSha256:'a'.repeat(64),executionReceiptDigest:'b'.repeat(64)}),
  })),/canary-audit-receipt-unverified/);
});

function githubStub({existing=false,changedMain=false,uncertainAt=null}={}){
  const calls=[];
  let branchSha=existing?COMMIT:null;
  async function fetchImpl(url,opts){
    const path=url.split('/repos/michaeljwilliams0123/Ultron.MW')[1];
    calls.push({method:opts.method,path});
    assert.equal(opts.redirect,'error');
    const response=(status,data)=>({ok:status>=200&&status<300,status,
      json:async()=>data});
    if(opts.method==='GET'&&path==='/git/ref/heads/main')
      return response(200,{object:{type:'commit',sha:changedMain?'f'.repeat(40):SHA}});
    if(opts.method==='GET'&&path==='/git/ref/heads/'+BRANCH)
      return branchSha?response(200,{object:{type:'commit',sha:branchSha}}):response(404,{});
    if(opts.method==='GET'&&path==='/git/commits/'+SHA)
      return response(200,{tree:{sha:TREE}});
    if(opts.method==='POST'&&path==='/git/commits'){
      const body=JSON.parse(opts.body);
      assert.equal(body.tree,TREE);
      assert.deepEqual(body.parents,[SHA]);
      assert.match(body.message,/Ultron-Operation-Digest: [0-9a-f]{64}/);
      if(uncertainAt==='commit')throw Error('ambiguous commit write');
      return response(201,{sha:COMMIT});
    }
    if(opts.method==='POST'&&path==='/git/refs'){
      assert.deepEqual(JSON.parse(opts.body),{ref:'refs/heads/'+BRANCH,sha:COMMIT});
      branchSha=COMMIT;
      if(uncertainAt==='ref')throw Error('ambiguous ref write');
      return response(201,{});
    }
    throw Error('Unexpected request '+opts.method+' '+path);
  }
  return {fetchImpl,calls};
}
const digest='c'.repeat(64);
const opInput={token:'ephemeral-token',persona:{role:'builder',
  authorName:'Ultron Builder',authorEmail:'builder@example.invalid'},
  targetBranch:BRANCH,sourceSha:SHA,operationDigest:digest,
  operationMarker:marker(digest)};

test('writer creates exactly one annotated canary commit and branch ref',async()=>{
  const h=githubStub();
  const result=await createCanaryCommitOperation({fetchImpl:h.fetchImpl})(opInput);
  assert.equal(result.sha,COMMIT);
  assert.deepEqual(h.calls.filter(x=>x.method==='POST').map(x=>x.path),
    ['/git/commits','/git/refs']);
});

test('pre-existing branch and stale main refuse writes',async()=>{
  for(const options of [{existing:true},{changedMain:true}]){
    const h=githubStub(options);
    await assert.rejects(createCanaryCommitOperation({fetchImpl:h.fetchImpl})(opInput),
      /canary-(branch-exists|source-head-changed)/);
    assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
  }
});

test('unknown provider write never retries; Task 4 must reconcile',async()=>{
  for(const uncertainAt of ['commit','ref']){
    const h=githubStub({uncertainAt});
    await assert.rejects(createCanaryCommitOperation({fetchImpl:h.fetchImpl})(opInput),
      /canary-github-outcome-unknown/);
    assert.equal(h.calls.filter(x=>x.path==='/git/commits').length,1);
    assert.equal(h.calls.filter(x=>x.path==='/git/refs').length,
      uncertainAt==='ref'?1:0);
  }
});

test('digest marker and persona are required before network calls',async()=>{
  const h=githubStub();
  await assert.rejects(createCanaryCommitOperation({fetchImpl:h.fetchImpl})(
    {...opInput,operationMarker:'wrong'}),/canary-operation-scope-invalid/);
  await assert.rejects(createCanaryCommitOperation({fetchImpl:h.fetchImpl})(
    {...opInput,persona:{authorName:'Builder'}}),/canary-persona-required/);
  assert.equal(h.calls.length,0);
});
