import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {createVerifiedGitHubClient} from '../src/auth/identity-factory.mjs';
import {enforceSignedApprovalAndTagPersona} from '../src/middleware/enforce-signed-approval.mjs';
import {dispatchHeadlessTask} from '../scripts/execute-autonomous-task.mjs';
import {executeIdempotentGitHubWrite} from '../src/engine/durable-executor.mjs';
import {verifyPostConditionsAndStoreReceipt} from '../scripts/verify-post-conditions.mjs';
import {runMasterPipeline,createCanaryCommitOperation,createCanaryLineageVerifier} from '../scripts/run-canary-pipeline.mjs';
import {requiredTokenPermissions,ULTRON_REPOSITORY_ID} from '../src/github-principal-policy.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const API='https://api.github.com/repos/'+REPO;
const BASE='1'.repeat(40),TREE='2'.repeat(40),COMMIT='3'.repeat(40),FOREIGN='4'.repeat(40);
const BRANCH='ultron/canary-integration-001';
const SECRET='test-only-approval-signing-key-with-ample-entropy';
const TOKEN='test-only-scoped-token-with-more-than-eight-characters';
const RSA=generateKeyPairSync('rsa',{modulusLength:2048});
const env={GITHUB_APP_ID:'321',GITHUB_INSTALLATION_ID:'42',
  GITHUB_PRIVATE_KEY:RSA.privateKey.export({format:'pem',type:'pkcs1'}).toString()};

function response(status,payload){return {status,ok:status>=200&&status<300,json:async()=>payload};}
function simulatedGitHub({fault=null}={}){
  let branch=null,created=null,verifiedRefReads=0;
  const calls=[];
  const fetchImpl=async (url,request={})=>{
    const method=request.method||'GET';
    const path=url.startsWith(API)?url.slice(API.length):url;
    calls.push({method,path});
    if(url==='https://api.github.com/app/installations/42/access_tokens'){
      const body=JSON.parse(request.body);
      assert.deepEqual(body.repository_ids,[ULTRON_REPOSITORY_ID]);
      return response(201,{token:TOKEN,
        permissions:body.permissions,expires_at:new Date(Date.now()+1800000).toISOString(),
        repositories:[{id:ULTRON_REPOSITORY_ID,full_name:REPO}]});
    }
    if(url===API&&method==='GET')
      return response(200,{id:ULTRON_REPOSITORY_ID,full_name:REPO});
    if(path==='/git/ref/heads/main'&&method==='GET')
      return response(200,{ref:'refs/heads/main',object:{type:'commit',sha:BASE}});
    if(path==='/git/ref/heads/'+BRANCH&&method==='GET'){
      if(branch)verifiedRefReads++;
      const observed=fault==='moved-head'&&verifiedRefReads>=4?FOREIGN:branch;
      return observed?response(200,{ref:'refs/heads/'+BRANCH,
        object:{type:'commit',sha:observed}}):response(404,{message:'not found'});
    }
    if(path==='/git/commits/'+BASE&&method==='GET')
      return response(200,{sha:BASE,tree:{sha:TREE},parents:[]});
    if(path==='/git/commits/'+COMMIT&&method==='GET')
      return created?response(200,created):response(404,{message:'not found'});
    if(path==='/git/commits'&&method==='POST'){
      const body=JSON.parse(request.body);
      assert.equal(body.tree,TREE);
      assert.deepEqual(body.parents,[BASE]);
      assert.match(body.message,/Ultron-Operation-Digest: [a-f0-9]{64}/);
      created={sha:COMMIT,message:body.message,
        tree:{sha:fault==='forged-tree'?FOREIGN:TREE},
        parents:[{sha:fault==='forged-parent'?FOREIGN:BASE}]};
      return response(201,{sha:COMMIT});
    }
    if(path==='/git/refs'&&method==='POST'){
      const body=JSON.parse(request.body);
      assert.deepEqual(body,{ref:'refs/heads/'+BRANCH,sha:COMMIT});
      if(fault!=='ref-never-created')branch=COMMIT;
      if(fault==='lost-ref-ack'||fault==='ref-never-created')
        throw Error('simulated connection loss after ref creation');
      return response(201,{ref:body.ref,object:{type:'commit',sha:COMMIT}});
    }
    throw Error('unexpected-test-provider-route '+method+' '+path);
  };
  return {fetchImpl,calls,get branch(){return branch;},get created(){return created;},
    get posts(){return calls.filter(x=>x.method==='POST'&&!x.path.includes('/access_tokens'));}};
}
function signedInput({nonce=randomUUID().replaceAll('-',''),planPatch={}}={}){
  const plan={schema:'ultron.github.operation.v1',repository:REPO,
    operation:'repair.branch.create',activeAgentRole:'Builder',
    idempotencyKey:'repair:integration-001',
    permittedScope:{operation:'repair.branch.create',repositoryId:ULTRON_REPOSITORY_ID,
      permissions:requiredTokenPermissions('repair.branch.create')},
    parameters:{taskId:'integration-001',objective:'Run bounded readback canary',
      branch:BRANCH,sourceSha:BASE},...planPatch};
  const digest=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const signedGrant={toolName:plan.operation,
    targetResource:'ultron:github:'+REPO+':sha256:'+digest,
    timestamp:Date.now(),nonce};
  const signature=createHmac('sha256',SECRET)
    .update(JSON.stringify(signedGrant)).digest('hex');
  return {payload:plan,activeAgentRole:plan.activeAgentRole,
    signedGrant,nonce,signature};
}
async function harness(t,{fault=null}={}){
  const db=new PGlite();
  const migrations=['0037_github_approval_nonces.sql','0039_github_idempotent_executions.sql'];
  for(const name of migrations)
    await db.exec(await readFile(new URL('../cloud/hatchable/migrations/'+name,import.meta.url),'utf8'));
  const cwd=await mkdtemp(join(tmpdir(),'ultron-integrated-canary-'));
  t.after(async()=>{await db.close();await rm(cwd,{recursive:true,force:true});});
  const github=simulatedGitHub({fault});
  let revoked=false;
  let expected=null;
  const services={
    createVerifiedGitHubClient:()=>createVerifiedGitHubClient({
      env,fetchImpl:github.fetchImpl,clock:Date.now}),
    enforceSignedApprovalAndTagPersona,dispatchHeadlessTask,
    executeIdempotentGitHubWrite,
    verifyPostConditionsAndStoreReceipt:receipt=>
      verifyPostConditionsAndStoreReceipt(receipt,{cwd}),
    gitOperation:createCanaryCommitOperation({fetchImpl:github.fetchImpl}),
    verifyRemoteLineage:createCanaryLineageVerifier({fetchImpl:github.fetchImpl}),
    trustedApproval:{db,trustedKey:SECRET,expectedInstallationId:42,clock:Date.now},
    durableServices:{db,clock:Date.now,fetchImpl:github.fetchImpl,
      authorization:{verify:async intent=>{
        if(revoked)throw Error('owner-revoked');
        assert.ok(expected,'signed operation not admitted');
        const digest=createHash('sha256').update(JSON.stringify(expected.payload)).digest('hex');
        assert.equal(intent.operationDigest,digest);
        assert.equal(intent.targetBranch,expected.payload.parameters.branch);
        assert.equal(intent.personaRole,'builder');
        const admitted=await db.query('SELECT target_resource FROM brain_github_approval_nonces WHERE nonce=$1',[expected.nonce]);
        assert.equal(admitted.rows.length,1,'trusted signer nonce must have been consumed');
        assert.equal(admitted.rows[0].target_resource,expected.signedGrant.targetResource);
        return {verified:true,repository:REPO,operationDigest:digest,
          targetBranch:intent.targetBranch,personaRole:'builder',
          expiresAt:new Date(Date.now()+120000).toISOString()};
      }}},
  };
  return {github,db,cwd,services,async run(input=signedInput()){
    expected=input;
    return runMasterPipeline(input,services);
  },revoke(){revoked=true;}};
}

test('real Tasks 1-5: signed grant, App token, PostgreSQL, GitHub write, durable and local receipts',async t=>{
  const h=await harness(t);
  const result=await h.run();
  assert.equal(result.status,'remote-verified');
  assert.equal(result.commitSha,COMMIT);
  assert.equal(result.productionAccepted,false);
  assert.equal(h.github.branch,COMMIT);
  assert.deepEqual(h.github.posts.map(p=>p.path),['/git/commits','/git/refs']);
  const ledger=await h.db.query('SELECT state,receipt FROM github_idempotent_executions');
  assert.equal(ledger.rows.length,1);
  assert.equal(ledger.rows[0].state,'completed');
  assert.equal(ledger.rows[0].receipt.details.remoteVerified,true);
  const stored=JSON.parse(await readFile(join(h.cwd,'receipts',
    'ultron-task-integration-001.json'),'utf8'));
  assert.equal(stored.status,'REMOTE_READBACK_REQUIRED');
  assert.equal(stored.remoteReadbackVerified,false);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('fresh signed nonce replays a completed task without another GitHub mutation',async t=>{
  const h=await harness(t);
  const first=await h.run();
  const second=await h.run(signedInput());
  assert.equal(first.commitSha,second.commitSha);
  assert.equal(first.auditSha256,second.auditSha256);
  assert.equal(h.github.posts.length,2);
  const rows=await h.db.query('SELECT idempotency_key FROM github_idempotent_executions');
  assert.equal(rows.rows.length,1);
});

test('same signed nonce replay is rejected before GitHub mutation',async t=>{
  const h=await harness(t),input=signedInput();
  await h.run(input);
  await assert.rejects(h.run(input),/approval|replay|invalid/i);
  assert.equal(h.github.posts.length,2);
});

test('lost GitHub ref response still reconciles via authenticated remote commit and durable receipt',async t=>{
  const h=await harness(t,{fault:'lost-ref-ack'});
  const result=await h.run();
  assert.equal(result.status,'remote-verified');
  assert.equal(h.github.posts.length,2);
  assert.equal(h.github.branch,COMMIT);
});

test('lost ref before creation holds for reconciliation rather than retrying',async t=>{
  const h=await harness(t,{fault:'ref-never-created'});
  await assert.rejects(h.run(),/canary-execution-receipt-unverified/);
  assert.equal(h.github.posts.length,2);
  const row=await h.db.query('SELECT state FROM github_idempotent_executions');
  assert.equal(row.rows[0].state,'reconcile_required');
  await assert.rejects(h.run(signedInput()),/canary-execution-receipt-unverified/);
  assert.equal(h.github.posts.length,2,'no second external mutation after unknown outcome');
});

test('owner revocation stops before any GitHub mutation',async t=>{
  const h=await harness(t);
  h.revoke();
  await assert.rejects(h.run(),/owner-revoked/);
  assert.equal(h.github.posts.length,0);
});

test('matching digest trailer on an unrelated-parent commit is not signed source lineage',async t=>{
  const h=await harness(t,{fault:'forged-parent'});
  await assert.rejects(h.run(),/canary-(?:execution-receipt-unverified|remote-lineage-invalid)/);
});


test('remote tree mismatch with signed source cannot pass the independent lineage gate',async t=>{
  const h=await harness(t,{fault:'forged-tree'});
  await assert.rejects(h.run(),/canary-(?:execution-receipt-unverified|remote-lineage-invalid)/);
});

test('branch movement after Task 4 verification cannot pass the conductor gate',async t=>{
  const h=await harness(t,{fault:'moved-head'});
  await assert.rejects(h.run(),/canary-remote-lineage-invalid/);
});


test('a forged-parent canary never commits a completed durable receipt',async t=>{
  const h=await harness(t,{fault:'forged-parent'});
  await assert.rejects(h.run(),/canary-(?:execution-receipt-unverified|remote-lineage-invalid)/);
  const result=await h.db.query('SELECT state, receipt FROM github_idempotent_executions');
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].state,'reconcile_required');
  assert.equal(result.rows[0].receipt,null);
  assert.equal(h.github.posts.length,2,'the write is never replayed');
});

test('a forged-tree canary never commits a completed durable receipt',async t=>{
  const h=await harness(t,{fault:'forged-tree'});
  await assert.rejects(h.run(),/canary-(?:execution-receipt-unverified|remote-lineage-invalid)/);
  const result=await h.db.query('SELECT state, receipt FROM github_idempotent_executions');
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].state,'reconcile_required');
  assert.equal(result.rows[0].receipt,null);
});
