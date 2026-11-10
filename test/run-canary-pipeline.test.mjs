import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBranchCanaryOperation,runMasterPipeline,
} from '../scripts/run-canary-pipeline.mjs';

const SHA='0123456789abcdef0123456789abcdef01234567';
const BRANCH='ultron/canary-smoke-test';
const params={taskId:'smoke-test-01',objective:'Verify one branch',
  sourceSha:SHA,branch:BRANCH};
const payload={schema:'ultron.github.operation.v1',
  repository:'michaeljwilliams0123/Ultron.MW',operation:'repair.branch.create',
  activeAgentRole:'Builder',idempotencyKey:'repair:smoke-test-01',
  permittedScope:{operation:'repair.branch.create',repositoryId:1424939667,
    permissions:{metadata:'read',contents:'write'}},parameters:params};
const request={signedGrant:{nonce:'unique-nonce'},nonce:'unique-nonce',
  signature:'authentic-ecdsa-signature',activeAgentRole:'Builder',payload};

function fakeStages(overrides={}){
  const stages={
    createVerifiedGitHubClient:async()=>({installationId:42,
      getTokenForScope:async operation=>({token:'ephemeral-token',operation})}),
    enforceSignedApprovalAndTagPersona:async()=>({authorized:true,
      token:'ephemeral-token',persona:{authorName:'Ultron Builder'},
      executionPayload:{...payload,parameters:{...params}}}),
    dispatchHeadlessTask:async(_objective,context)=>({...context,stage:'prepared'}),
    executeIdempotentGitHubWrite:async(task,token,persona,operation)=>({
      idempotencyKey:'ultron-task-'+task.taskId,status:'completed',
      details:await operation({token,persona,targetBranch:task.targetBranch}),
    }),
    verifyPostConditionsAndStoreReceipt:async receipt=>({...receipt,
      auditPath:'receipts/ultron-task-smoke-test-01.json'}),
    gitOperation:async ({persona,targetBranch,sourceSha})=>({
      branch:targetBranch,sha:sourceSha,remoteReadbacks:2,
      commitAuthor:persona.authorName,
    }),
  };
  stages.dispatchHeadlessTask.supportsPrepareOnly=true;
  return {...stages,...overrides};
}

test('five-step conductor completes only with bound receipts',async()=>{
  const result=await runMasterPipeline(request,fakeStages());
  assert.equal(result.status,'verified');
  assert.equal(result.idempotencyKey,'ultron-task-smoke-test-01');
  assert.equal(result.branch,BRANCH);
  assert.ok(!JSON.stringify(result).includes('ephemeral-token'));
});

test('unsigned and improperly shaped requests are rejected before identity',async()=>{
  let invoked=false;
  const deps=fakeStages({createVerifiedGitHubClient:async()=>{
    invoked=true;return {};}});
  await assert.rejects(runMasterPipeline({...request,signature:''},deps),
    /canary-signed-grant-required/);
  await assert.rejects(runMasterPipeline({...request,payload:{...payload,
    operation:'repository.settings.update'}},deps),/canary-signed-plan-invalid/);
  assert.equal(invoked,false);
});

test('authorization must bind task, source SHA and branch',async()=>{
  const deps=fakeStages({enforceSignedApprovalAndTagPersona:async()=>({
    authorized:true,token:'ephemeral',persona:{authorName:'Builder'},
    executionPayload:{...payload,parameters:{...params,branch:'ultron/canary-elsewhere'}},
  })});
  await assert.rejects(runMasterPipeline(request,deps),
    /canary-authorization-payload-mismatch/);
});

test('dispatcher cannot swap signed task or branch',async()=>{
  const swapped=async()=>({taskId:'changed',targetBranch:BRANCH,sourceSha:SHA});
  swapped.supportsPrepareOnly=true;
  const deps=fakeStages({dispatchHeadlessTask:swapped});
  await assert.rejects(runMasterPipeline(request,deps),
    /canary-dispatcher-context-mismatch/);
});

test('old dispatcher is blocked before unsafe graph execution',async()=>{
  let invoked=0;
  const deps=fakeStages({dispatchHeadlessTask:async()=>{invoked++;}});
  await assert.rejects(runMasterPipeline(request,deps),
    /canary-dispatcher-prepare-contract-required/);
  assert.equal(invoked,0);
});

test('unverified execution receipt stops audit',async()=>{
  let auditCalled=false;
  const deps=fakeStages({
    executeIdempotentGitHubWrite:async()=>({idempotencyKey:'ultron-task-smoke-test-01',
      status:'completed',details:{sha:'f'.repeat(40),branch:BRANCH,remoteReadbacks:2}}),
    verifyPostConditionsAndStoreReceipt:async()=>{auditCalled=true;},
  });
  await assert.rejects(runMasterPipeline(request,deps),
    /canary-execution-receipt-unverified/);
  assert.equal(auditCalled,false);
});

function githubStub({existing=false,uncertain=false,changedMain=false,
  conflict=false,unverified=false}={}){
  const calls=[];
  let branchSha=existing?(conflict?'f'.repeat(40):SHA):null;
  async function fetchImpl(url,opts){
    const path=url.split('/repos/michaeljwilliams0123/Ultron.MW')[1];
    calls.push({method:opts.method,path});
    assert.equal(opts.redirect,'error');
    const response=(status,value)=>({status,ok:status>=200&&status<300,
      json:async()=>value});
    if(opts.method==='GET'&&path==='/git/ref/heads/main')return response(200,{
      object:{sha:changedMain?'f'.repeat(40):SHA,type:'commit'},
    });
    if(opts.method==='GET'&&path==='/git/ref/heads/'+BRANCH)
      return branchSha?response(200,{ref:'refs/heads/'+BRANCH,
        object:{type:'commit',sha:unverified?'f'.repeat(40):branchSha}})
        :response(404,{});
    if(opts.method==='POST'&&path==='/git/refs'){
      assert.deepEqual(JSON.parse(opts.body),{
        ref:'refs/heads/'+BRANCH,sha:SHA});
      branchSha=SHA;
      if(uncertain)throw Error('socket closed after write');
      return response(201,{});
    }
    throw Error('unexpected request '+opts.method+' '+path);
  }
  return {calls,fetchImpl};
}

const operationInput={token:'ephemeral-token',persona:{authorName:'Builder'},
  targetBranch:BRANCH,sourceSha:SHA};

test('real create branch operation performs POST once and two verified GETs',async()=>{
  const {calls,fetchImpl}=githubStub();
  const result=await createBranchCanaryOperation({fetchImpl})(operationInput);
  assert.equal(result.sha,SHA);
  assert.equal(result.remoteReadbacks,2);
  assert.equal(calls.filter(x=>x.method==='POST').length,1);
  assert.equal(calls.filter(x=>x.method==='GET'&&x.path.includes(BRANCH)).length,3);
});

test('replay with existing matching branch avoids another mutation',async()=>{
  const {calls,fetchImpl}=githubStub({existing:true});
  await createBranchCanaryOperation({fetchImpl})(operationInput);
  assert.equal(calls.filter(x=>x.method==='POST').length,0);
});

test('unknown POST response reconciles by readback without retry',async()=>{
  const {calls,fetchImpl}=githubStub({uncertain:true});
  const result=await createBranchCanaryOperation({fetchImpl})(operationInput);
  assert.equal(result.sha,SHA);
  assert.equal(calls.filter(x=>x.method==='POST').length,1);
});

test('stale base or branch conflict fails closed without POST',async()=>{
  for(const options of [{changedMain:true},{existing:true,conflict:true}]){
    const {calls,fetchImpl}=githubStub(options);
    await assert.rejects(createBranchCanaryOperation({fetchImpl})(operationInput),
      /canary-(source-head-changed|branch-conflict)/);
    assert.equal(calls.filter(x=>x.method==='POST').length,0);
  }
});

test('contradictory remote confirmation cannot report success',async()=>{
  const {fetchImpl}=githubStub({unverified:true});
  await assert.rejects(createBranchCanaryOperation({fetchImpl})(operationInput),
    /canary-remote-postcondition-unverified/);
});
