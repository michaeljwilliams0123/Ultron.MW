import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,sign as signEd25519} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {enforceSignedApprovalAndTagPersona} from '../../../src/middleware/enforce-signed-approval.mjs';
import {executeGovernedGitHubAppMutation} from '../index.mjs';
import {createTrustedComposioCouncilVerifier,councilAttestationSigningBytes,createPostgresComposioCouncilNonceStore} from '../../../src/security/composio-council-attestation.mjs';
import {requiredTokenPermissions} from '../../../src/github-principal-policy.mjs';
import {
 createComposioDurableAppExecutor,isComposioDurableAppExecutor,
} from '../durable-readback.mjs';

const REPO='michaeljwilliams0123/Ultron.MW',SOURCE='a'.repeat(40),REMOTE='b'.repeat(40);
const KEY='ci-test-only-hmac-owner-key-long-enough-abcdefgh123456';
const OP='repair.branch.create',TASK='composio-canary-001';
const branch='canary/composio-pr442-readback';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

async function setup({initial='absent',callback='commit',auth=true,approve=true}={}){
 const db=new PGlite();
 try{
  for(const f of ['0037_github_approval_nonces.sql','0039_github_idempotent_executions.sql'])
   await db.exec(await readFile(new URL('../../../cloud/hatchable/migrations/'+f,import.meta.url),'utf8'));
  const now=Date.now();
  const plan={schema:'ultron.github.operation.v1',repository:REPO,operation:OP,
   activeAgentRole:'Builder',idempotencyKey:'repair:'+TASK,
   permittedScope:{operation:OP,repositoryId:1424939667,
     permissions:requiredTokenPermissions(OP)},
   parameters:{taskId:TASK,sourceSha:SOURCE,branch}};
  const signedGrant={
   toolName:OP,
   targetResource:'ultron:github:'+REPO+':sha256:'+digest(plan),
   timestamp:now,
   nonce:'pr442-durable-readback-'+String(now)+'-abcdefgh',
  };
  const operationRequest={signedGrant,nonce:signedGrant.nonce,
   signature:createHmac('sha256',KEY).update(JSON.stringify(signedGrant)).digest('hex'),
   payload:plan,activeAgentRole:'Builder'};
  const tokenFactory={getTokenForScope:async scope=>({
   token:'ci-test-scoped-app-token-not-live',...scope,installationId:42,
   expiresAt:new Date(now+600000).toISOString()
  })};
  const ownerTrust={db,trustedKey:KEY,expectedInstallationId:42,clock:()=>now};
  const approved=approve?await enforceSignedApprovalAndTagPersona(
   operationRequest,tokenFactory,ownerTrust):null;
  let remote=initial,writes=0,reads=0,authorizations=0;
  const services={
   db,clock:()=>now,
   authorization:{verify:async intent=>{
    authorizations++;
    return {verified:auth,operationDigest:intent.operationDigest,
     repository:intent.repository,targetBranch:intent.targetBranch,
     personaRole:intent.personaRole,expiresAt:new Date(now+240000).toISOString()};
   }},
   remote:{inspect:async()=>{reads++;
    if(remote==='throw-403')throw Error('403 token revoked');
    return {state:remote,sha:remote==='matched'?REMOTE:undefined};
   }},
  };
  const gitOperation=async request=>{
   writes++;
   assert.equal(request.targetBranch,branch);
   assert.equal(request.sourceSha,SOURCE);
   assert.equal(request.operationMarker,'Ultron-Operation-Digest: '+digest(plan));
   if(callback==='throw-before'){throw Error('timeout before network effect');}
   if(callback==='commit'||callback==='commit-lost-ack')remote='matched';
   if(callback==='commit-lost-ack')throw Error('lost response after mutation');
   if(callback==='write-403'){remote='throw-403';throw Error('write failed: HTTP 403');}
   if(callback==='http-200-no-op')return {status:200};
   return {status:201};
  };
  const executor=createComposioDurableAppExecutor({services,gitOperation});
  return {db,approved,executor,now,operationRequest,tokenFactory,ownerTrust,
    get writes(){return writes;},get reads(){return reads;},
    get authorizations(){return authorizations;},
    setRemote:x=>{remote=x;}};
 }catch(e){await db.close();throw e;}
}

test('a valid signed owner grant plus independent readback yields a durable immutable 0039 receipt',async()=>{
 const h=await setup();
 try{
  assert.equal(isComposioDurableAppExecutor(h.executor),true);
  const receipt=await h.executor(h.approved);
  assert.equal(receipt.status,'success');
  assert.equal(receipt.details.remoteVerified,true);
  assert.equal(receipt.details.operationDigest,digest(h.approved.executionPayload));
  assert.equal(receipt.details.sha,REMOTE);
  assert.ok(h.reads>=2);
  const row=await h.db.query(
   'SELECT state,receipt FROM github_idempotent_executions WHERE idempotency_key=$1',
   [receipt.idempotencyKey]);
  assert.equal(row.rows[0].state,'completed');
  assert.equal(row.rows[0].receipt.details.sha,REMOTE);
  await assert.rejects(h.db.query('DELETE FROM github_idempotent_executions'),/immutable/);
  const replay=await h.executor(h.approved);
  assert.deepEqual(replay,receipt);
  assert.equal(h.writes,1);
 }finally{await h.db.close();}
});
test('a provider 200 without matching remote state never produces VERIFIED',async()=>{
 const h=await setup({callback:'http-200-no-op'});
 try{
  const result=await h.executor(h.approved);
  assert.equal(result.status,'reconcile_required');
  assert.equal(result.details.remoteVerified,false);
  assert.equal(h.writes,1);
  const row=await h.db.query('SELECT state,receipt FROM github_idempotent_executions');
  assert.equal(row.rows[0].state,'reconcile_required');
  assert.equal(row.rows[0].receipt,null);
  const replay=await h.executor(h.approved);
  assert.equal(replay.status,'reconcile_required');
  assert.equal(h.writes,1);
 }finally{await h.db.close();}
});
test('a provider timeout after a committed mutation verifies by independent readback',async()=>{
 const h=await setup({callback:'commit-lost-ack'});
 try{
  const result=await h.executor(h.approved);
  assert.equal(result.status,'success');
  assert.equal(result.details.remoteVerified,true);
  assert.equal(h.writes,1);
 }finally{await h.db.close();}
});
test('401/403 readback uncertainty holds and does not automatically retry',async()=>{
 const h=await setup({callback:'commit'});
 try{
  h.setRemote('throw-403');
  const result=await h.executor(h.approved);
  assert.equal(result.status,'reconcile_required');
  assert.equal(h.writes,0);
  const again=await h.executor(h.approved);
  assert.equal(again.status,'reconcile_required');
  assert.equal(h.writes,0);
 }finally{await h.db.close();}
});
test('authorization denial blocks tokenized remote side effects before write reservation',async()=>{
 const h=await setup({auth:false});
 try{
  await assert.rejects(h.executor(h.approved),/authorization-rejected/);
  assert.equal(h.writes,0);
  const row=await h.db.query('SELECT count(*)::int AS count FROM github_idempotent_executions');
  assert.equal(row.rows[0].count,0);
 }finally{await h.db.close();}
});
test('conflicting provider state holds for reconciliation instead of reporting success',async()=>{
 const h=await setup({initial:'conflict'});
 try{
  const result=await h.executor(h.approved);
  assert.equal(result.status,'reconcile_required');
  assert.equal(h.writes,0);
 }finally{await h.db.close();}
});
test('concurrent duplicate operations share one 0039 admission row and at most one write',async()=>{
 const h=await setup();
 try{
  const results=await Promise.allSettled([h.executor(h.approved),h.executor(h.approved)]);
  assert.equal(h.writes,1);
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.status==='success').length,1);
  const row=await h.db.query('SELECT count(*)::int AS count FROM github_idempotent_executions');
  assert.equal(row.rows[0].count,1);
 }finally{await h.db.close();}
});
test('ad hoc callback and forged authorization object cannot impersonate the vetted executor',async()=>{
 const h=await setup();
 try{
  assert.equal(isComposioDurableAppExecutor(async()=>({status:'success'})),false);
  const forged={authorized:true,executionPayload:h.approved.executionPayload,
   persona:h.approved.persona,token:'fake-token'};
  await assert.rejects(h.executor(forged),/trusted approved operation required/);
  assert.equal(h.writes,0);
 }finally{await h.db.close();}
});

test('401/403 reported during mutation stays unresolved and cannot auto-repeat a write',async()=>{
 const h=await setup({callback:'write-403'});
 try{
  const first=await h.executor(h.approved);
  assert.equal(first.status,'reconcile_required');
  assert.equal(first.details.remoteVerified,false);
  assert.equal(h.writes,1);
  const second=await h.executor(h.approved);
  assert.equal(second.status,'reconcile_required');
  assert.equal(h.writes,1);
  const row=await h.db.query('SELECT state,receipt FROM github_idempotent_executions');
  assert.equal(row.rows[0].state,'reconcile_required');
  assert.equal(row.rows[0].receipt,null);
 }finally{await h.db.close();}
});
test('fully signed Council and owner plans reach only the real durable App executor',async()=>{
 const h=await setup({approve:false});
 try{
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const envelope={
   schema:'ultron.composio.council-attestation.v1',
   keyId:'council-release-main',
   sourceSha:SOURCE,prNumber:442,
   issuedAt:h.now-1000,expiresAt:h.now+240000,
   nonce:'council-composio-readback-'+String(h.now)+'-abcdefgh',
   result:{status:'accepted',approvedCount:7,securitySensitive:false,
    sourceSha:SOURCE,prNumber:442},
  };
  const raw={...envelope,signature:'A'.repeat(86)};
  const signature=signEd25519(null,councilAttestationSigningBytes(raw),privateKey).toString('base64url');
  const councilAttestation={...envelope,signature};
  const verifyCouncilAttestation=createTrustedComposioCouncilVerifier({
   keys:{'council-release-main':publicKey},
   nonceStore:createPostgresComposioCouncilNonceStore({db:h.db}),
   clock:()=>h.now,
  });
  const receipt=await executeGovernedGitHubAppMutation({
   operationRequest:h.operationRequest,
   tokenFactory:h.tokenFactory,
   trusted:{...h.ownerTrust,verifyCouncilAttestation},
   councilAttestation,sha:SOURCE,prNumber:442,
   durableAppExecutor:h.executor,
  });
  assert.equal(receipt.status,'success');
  assert.equal(receipt.details.remoteVerified,true);
  assert.equal(h.writes,1);
  const nonceCounts=await h.db.query(
   'SELECT count(*)::int AS n FROM brain_github_approval_nonces');
  assert.equal(nonceCounts.rows[0].n,2,'Council and owner nonces are distinct and both persisted');
  await assert.rejects(executeGovernedGitHubAppMutation({
   operationRequest:h.operationRequest,tokenFactory:h.tokenFactory,
   trusted:{...h.ownerTrust,verifyCouncilAttestation},
   councilAttestation,sha:SOURCE,prNumber:442,
   durableAppExecutor:h.executor,
  }),/Council attestation verification failed/);
  assert.equal(h.writes,1);
 }finally{await h.db.close();}
});
