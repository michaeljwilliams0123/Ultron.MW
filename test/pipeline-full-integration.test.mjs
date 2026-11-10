/**
 * TEST-ONLY cross-PR composition check. No owner credentials, live GitHub
 * writes, deployments, or model invocations. These are synthetic providers.
 * The trusted production composition root still requires live acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {createVerifiedGitHubClient}
 from '../src/auth/identity-factory.mjs';
import {enforceSignedApprovalAndTagPersona}
 from '../src/middleware/enforce-signed-approval.mjs';
import {dispatchHeadlessTask}
 from '../scripts/execute-autonomous-task.mjs';
import {executeIdempotentGitHubWrite}
 from '../src/engine/durable-executor.mjs';
import {verifyPostConditionsAndStoreReceipt}
 from '../scripts/verify-post-conditions.mjs';
import {runMasterPipeline}
 from '../scripts/run-canary-pipeline.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const SOURCE='a'.repeat(40),COMMIT='b'.repeat(40);
const HMAC_KEY='synthetic-only-HMAC-key-for-integration-testing-1234567';

test('Tasks 1 through 5 compose with signed one-use grant, PostgreSQL and verified synthetic readback',async t=>{
 let PGlite;try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
 if(!PGlite){if(process.env.CI==='true')throw Error('PGlite required in CI');
  t.skip('PGlite not installed');return;}
 const db=new PGlite(),cwd=mkdtempSync(join(tmpdir(),'ultron-composition-'));
 t.after(async()=>{await db.close();rmSync(cwd,{recursive:true,force:true});});
 for(const name of ['0037_github_approval_nonces.sql',
   '0039_github_idempotent_executions.sql']){
  const raw=await readFile(new URL('../cloud/hatchable/migrations/'+name,import.meta.url),'utf8');
  await db.exec(raw);
 }
 const now=Date.now();
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const env={GITHUB_APP_ID:'12345',GITHUB_INSTALLATION_ID:'42',
  GITHUB_PRIVATE_KEY:privateKey.export({type:'pkcs1',format:'pem'})};
 let remote='absent',writes=0,tokenExchanges=0;
 const fetchImpl=async(url,opts)=>{
  if(url==='https://api.github.com/app/installations/42/access_tokens'){
   tokenExchanges++;
   const body=JSON.parse(opts.body);
   assert.deepEqual(body.repository_ids,[REPO_ID]);
   return {ok:true,status:201,json:async()=>({
    token:'synthetic-scoped-token',expires_at:new Date(now+1800000).toISOString(),
    permissions:body.permissions,repositories:[{id:REPO_ID,full_name:REPO}]
   })};
  }
  if(url==='https://api.github.com/repos/'+REPO&&opts.method==='GET')
   return {ok:true,status:200,json:async()=>({id:REPO_ID,full_name:REPO})};
  throw Error('unexpected synthetic GitHub request');
 };
 const payload={
  schema:'ultron.github.operation.v1',repository:REPO,
  operation:'repair.branch.create',activeAgentRole:'Builder',
  idempotencyKey:'repair:smoke-test-01',
  permittedScope:{operation:'repair.branch.create',repositoryId:REPO_ID,
   permissions:{metadata:'read',contents:'write'}},
  parameters:{taskId:'smoke-test-01',objective:'Verify one bounded branch',
   sourceSha:SOURCE,branch:'ultron/canary-smoke-test'}
 };
 const nonce='integrated-oneuse-nonce-001abcdefgh';
 const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const signedGrant={
  toolName:payload.operation,targetResource:'ultron:github:'+REPO+':sha256:'+digest,
  timestamp:now,nonce
 };
 const request={signedGrant,nonce,payload,activeAgentRole:'Builder',
  signature:createHmac('sha256',HMAC_KEY)
   .update(JSON.stringify(signedGrant)).digest('hex')};
 const authorization={verify:async intent=>({
  verified:true,operationDigest:intent.operationDigest,
  repository:intent.repository,targetBranch:intent.targetBranch,
  personaRole:intent.personaRole,
  expiresAt:new Date(now+240000).toISOString()
 })};
 const services={db,clock:()=>now,authorization,
  remote:{inspect:async()=>({state:remote,
   ...(remote==='matched'?{sha:COMMIT}:{})})}};
 const dependencies={
  createVerifiedGitHubClient:()=>createVerifiedGitHubClient({
   env,fetchImpl,clock:()=>now
  }),
  enforceSignedApprovalAndTagPersona,dispatchHeadlessTask,
  executeIdempotentGitHubWrite,
  verifyPostConditionsAndStoreReceipt:receipt=>
   verifyPostConditionsAndStoreReceipt(receipt,{cwd,now:()=>new Date(now)}),
  gitOperation:async ({token,persona,targetBranch,sourceSha,operationDigest,operationMarker})=>{
   writes++;
   assert.equal(token,'synthetic-scoped-token');
   assert.equal(persona.role,'builder');
   assert.equal(persona.authorName,'Ultron.MW [Builder]');
   assert.equal(persona.authorEmail,'ultron-mw-builder@system.local');
   assert.equal(sourceSha,SOURCE);
   assert.equal(targetBranch,payload.parameters.branch);
   assert.equal(operationMarker,'Ultron-Operation-Digest: '+operationDigest);
   remote='matched';
   return {branch:targetBranch,sha:COMMIT,operationDigest};
  },
  trustedApproval:{db,trustedKey:HMAC_KEY,algorithm:'hmac-sha256',
   expectedInstallationId:42,clock:()=>now},
  durableServices:services
 };
 assert.equal(dispatchHeadlessTask.supportsPrepareOnly,true);
 const result=await runMasterPipeline(request,dependencies);
 assert.equal(result.status,'remote-verified');
 assert.equal(result.productionAccepted,false);
 assert.equal(result.commitSha,COMMIT);
 assert.equal(result.auditStatus,'REMOTE_READBACK_REQUIRED');
 assert.equal(writes,1);
 assert.ok(tokenExchanges>=3);
 assert.ok(!JSON.stringify(result).includes('synthetic-scoped-token'));
 const nonceCount=await db.query('SELECT COUNT(*)::int AS n FROM brain_github_approval_nonces');
 assert.equal(nonceCount.rows[0].n,1);
 const rows=await db.query('SELECT state FROM github_idempotent_executions');
 assert.deepEqual(rows.rows.map(x=>x.state),['completed']);
 assert.equal(existsSync(join(cwd,'receipts',result.idempotencyKey+'.json')),true);
 await assert.rejects(runMasterPipeline(request,dependencies),
  /invalid|replay|approval|denied/i);
 assert.equal(writes,1,'replayed owner grant cannot perform a second GitHub write');
});
