import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adjudicator,canary,database,sign,otherKey,github,counts,publicJwk,APP,SOURCE,REPO}
 from './helpers/github-branch-canary-fixture.mjs';
import {executeIdempotentGitHubWrite} from '../src/engine/durable-executor.mjs';
import {DEFAULT_OPERATIONS,normalizeOwnerProfile}
 from '../cloud/hatchable/lib/owner-autonomy-control.js';

async function prepared(t,options){
 const db=await database(t,options);
 const p=await canary.prepareBranchCanary({db,sourceSha:SOURCE});
 return {db,...p};
}
const run=(h,envelope,gh,extra={})=>canary.runBranchCanary({db:h.db,prepared:h.prepared,
 envelope,publicJwk,appCredentials:APP,fetchImpl:gh.fetchImpl,...extra});
async function state(db){
 return (await db.query(`SELECT state,grant_id,receipt FROM github_idempotent_executions`)).rows;
}

test('happy path: owner grant, atomic reservation, one branch write, readback and audit',async t=>{
 const h=await prepared(t),gh=github(),envelope=await sign(h.ownerGrantRequest);
 const result=await run(h,envelope,gh);
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.http,201);
 assert.equal(result.branch,h.prepared.branch);
 assert.equal(result.commitSha,'c'.repeat(40));
 assert.equal(result.productionAccepted,false);
 assert.equal(gh.posts('/git/commits'),1);
 assert.equal(gh.posts('/git/refs'),1);
 assert.deepEqual(await counts(h.db),{nonces:1,grants:1,executions:1});
 const [row]=await state(h.db);
 assert.equal(row.state,'completed');
 assert.equal(row.grant_id,JSON.parse(envelope.payload).grantId);
 assert.equal(row.receipt.details.remoteVerified,true);
 const events=(await h.db.query(`SELECT event_type,details FROM brain_events
  WHERE event_type LIKE 'github-branch-canary-%' ORDER BY id`)).rows;
 assert.deepEqual(events.map(e=>e.event_type),
  ['github-branch-canary-reserved','github-branch-canary-audited']);
 assert.equal(events[1].details.providerReadbackStatus,'matched');
 assert.equal(events[1].details.remoteReadbackVerified,false);
 assert.equal(Object.hasOwn(events[1].details,'providerReadback'),false);
 assert.equal(result.providerReadbackStatus,'matched');
 assert.equal(result.remoteReadbackVerified,false);
 assert.equal(events[1].details.auditSha256,result.auditSha256);
 // Token scopes: one contents:write for the write, one contents:read for Task 5.
 const tokens=gh.calls.filter(c=>c.url.endsWith('/access_tokens')).length;
 assert.equal(tokens,2);
 // Replay of the same signed envelope never reaches the provider again.
 const replay=await run(h,envelope,gh);
 assert.deepEqual([replay.http,replay.error,replay.status],[409,'execution-already-reserved','completed']);
 assert.equal(gh.posts('/git/refs'),1);
});

test('repair.branch.create is off by default: prepare and reservation both deny',async t=>{
 const db=await database(t,{allowed:false});
 await assert.rejects(canary.prepareBranchCanary({db,sourceSha:SOURCE}),/authority-state-denied/);
 for(const preset of Object.values(DEFAULT_OPERATIONS))
  assert.equal(preset.includes('repair.branch.create'),false);
 const seed=await readFile(new URL('../cloud/hatchable/migrations/0016_owner_autonomy_profile.sql',import.meta.url),'utf8');
 assert.doesNotMatch(seed,/repair\.branch\.create/);
 const migration=await readFile(new URL('../cloud/hatchable/migrations/0044_github_branch_grant_executions.sql',import.meta.url),'utf8');
 assert.doesNotMatch(migration,/UPDATE brain_owner_autonomy_profile|INSERT INTO brain_owner_autonomy_profile/);
 const p=canary.validatePreparedBranchCanary((await canary.prepareBranchCanary({
  db:{query:async()=>({rows:[{profile_version:7,stop_version:5,paused:false,max_paid_cents:0,allowed:true}]})},
  sourceSha:SOURCE})).prepared);
 const request={...canary.branchGrantRequest(p),policySha:adjudicator.BRANCH_POLICY_SHA,profileVersion:7,stopVersion:5};
 const gh=github();
 const result=await canary.runBranchCanary({db,prepared:p,envelope:await sign(request),
  publicJwk,appCredentials:APP,fetchImpl:gh.fetchImpl});
 assert.deepEqual([result.http,result.error],[403,'authority-or-replay-denied']);
 assert.deepEqual(await counts(db),{nonces:0,grants:0,executions:0});
 assert.equal(gh.calls.length,0);
 // The owner can still explicitly select it through the existing profile API.
 assert.ok(normalizeOwnerProfile({owner:'michaeljwilliams0123',preset:'build',version:2,
  stopVersion:1,paused:false,maxPaidCents:0,
  allowedOperations:[...DEFAULT_OPERATIONS.build,'repair.branch.create']})
  .allowedOperations.includes('repair.branch.create'));
});

test('bad signature, expired grant and wrong scope are denied before any ledger write',async t=>{
 const h=await prepared(t),gh=github();
 const forged=await sign(h.ownerGrantRequest,{key:await otherKey()});
 const expired=await sign(h.ownerGrantRequest,{now:Date.now()-600000});
 const widened=await sign(h.ownerGrantRequest,{overrides:{resource:
  `github:branch:${REPO}:ultron/canary-other:sha256:${'f'.repeat(64)}`}});
 const longTtl=await sign(h.ownerGrantRequest,{ttl:10*60*1000});
 for(const envelope of [forged,expired,widened,longTtl]){
  const result=await run(h,envelope,gh);
  assert.deepEqual([result.http,result.error],[403,'authority-not-verified']);
 }
 assert.deepEqual(await counts(h.db),{nonces:0,grants:0,executions:0});
 assert.equal(gh.calls.length,0);
 const offCanary=`github:branch:${REPO}:main:sha256:${'f'.repeat(64)}`;
 const mainGrant=await sign(h.ownerGrantRequest,{overrides:{resource:offCanary}});
 await assert.rejects(adjudicator.verifyDelegatedGrant({envelope:mainGrant,publicJwk,
  request:{...canary.branchGrantRequest(h.prepared),resource:offCanary}}),
  /invalid-grant-branch-scope/);
});

test('a replayed 0037 nonce is denied without a reservation or provider call',async t=>{
 const h=await prepared(t),gh=github(),envelope=await sign(h.ownerGrantRequest);
 await h.db.query(`INSERT INTO brain_github_approval_nonces(nonce,operation,target_resource,
  approval_timestamp,expires_at) VALUES($1,'repair.branch.create','x',now(),now()+interval '5 minutes')`,
 [JSON.parse(envelope.payload).grantId]);
 const result=await run(h,envelope,gh);
 assert.deepEqual([result.http,result.error],[403,'authority-or-replay-denied']);
 assert.deepEqual(await counts(h.db),{nonces:1,grants:0,executions:0});
 assert.equal(gh.calls.length,0);
});

test('stop engaged denies at reservation, and a stop after reservation blocks the write',async t=>{
 const h=await prepared(t),gh=github();
 await h.db.query(`UPDATE brain_runtime_control SET paused=true WHERE id=1`);
 const denied=await run(h,await sign(h.ownerGrantRequest),gh);
 assert.deepEqual([denied.http,denied.error],[403,'authority-or-replay-denied']);
 assert.equal(gh.calls.length,0);

 const h2=await prepared(t);
 const late=github({onToken:async permissions=>{
  if(permissions.contents==='write')
   await h2.db.query(`UPDATE brain_runtime_control SET paused=true WHERE id=1`);
 }});
 const blocked=await run(h2,await sign(h2.ownerGrantRequest),late);
 assert.deepEqual([blocked.http,blocked.status],[503,'reserved']);
 assert.equal(late.posts('/git/commits')+late.posts('/git/refs'),0);
 assert.equal((await state(h2.db))[0].state,'reserved');
});

test('unconfigured or mismatched App credentials fail closed with no provider call',async t=>{
 const h=await prepared(t),gh=github(),envelope=await sign(h.ownerGrantRequest);
 for(const appCredentials of [undefined,{...APP,privateKey:''},{...APP,appId:'1'},
  {...APP,installationId:'2'}])
  await assert.rejects(run(h,envelope,gh,{appCredentials}),/configuration-invalid/);
 assert.equal(gh.calls.length,0);
 assert.deepEqual(await counts(h.db),{nonces:0,grants:0,executions:0});
});

test('App without contents:write (UNCONFIRMED in production) holds the reservation pre-dispatch',async t=>{
 const h=await prepared(t),gh=github({denyWrite:true});
 const result=await run(h,await sign(h.ownerGrantRequest),gh);
 assert.deepEqual([result.http,result.status,result.error],[503,'reserved','canary-dispatch-unavailable']);
 assert.equal(gh.posts('/git/commits')+gh.posts('/git/refs'),0);
});

test('readback mismatch after the write holds reconcile_required and reconcile never writes',async t=>{
 const h=await prepared(t),gh=github({tamperTree:true}),envelope=await sign(h.ownerGrantRequest);
 const result=await run(h,envelope,gh);
 assert.deepEqual([result.http,result.status],[202,'reconcile-required']);
 assert.equal((await state(h.db))[0].state,'reconcile_required');
 await assert.rejects(canary.reconcileBranchCanary({db:h.db,prepared:h.prepared,
  grantId:JSON.parse(envelope.payload).grantId,appCredentials:APP,fetchImpl:gh.fetchImpl}),
  /readback-conflict/);
 assert.equal(gh.posts('/git/commits'),1);
 assert.equal(gh.posts('/git/refs'),1);
});

test('unknown ref ACK is reconciled by read-only readback with no blind retry',async t=>{
 const h=await prepared(t),gh=github({loseRefAck:true}),envelope=await sign(h.ownerGrantRequest);
 const grantId=JSON.parse(envelope.payload).grantId;
 const result=await run(h,envelope,gh);
 assert.deepEqual([result.http,result.status],[202,'reconcile-required']);
 assert.equal((await state(h.db))[0].state,'reconcile_required');
 const before=gh.calls.filter(c=>c.method==='POST'&&c.url.includes('/git/')).length;
 const reconciled=await canary.reconcileBranchCanary({db:h.db,prepared:h.prepared,grantId,
  appCredentials:APP,fetchImpl:gh.fetchImpl});
 assert.equal(reconciled.status,'reconciled_success');
 assert.equal(gh.calls.filter(c=>c.method==='POST'&&c.url.includes('/git/')).length,before);
 assert.equal(gh.posts('/git/refs'),1);
 assert.equal((await state(h.db))[0].state,'completed');
 const again=await canary.reconcileBranchCanary({db:h.db,prepared:h.prepared,grantId,
  appCredentials:APP,fetchImpl:gh.fetchImpl});
 assert.equal(again.status,'recovered_success');
 await assert.rejects(canary.reconcileBranchCanary({db:h.db,prepared:h.prepared,
  grantId:'other-grant-123',appCredentials:APP,fetchImpl:gh.fetchImpl}),/intent-conflict/);
});

test('lost commit ACK before any ref leaves the branch absent and unresolved',async t=>{
 const h=await prepared(t),gh=github({loseCommitAck:true}),envelope=await sign(h.ownerGrantRequest);
 const result=await run(h,envelope,gh);
 assert.equal(result.status,'reconcile-required');
 await assert.rejects(canary.reconcileBranchCanary({db:h.db,prepared:h.prepared,
  grantId:JSON.parse(envelope.payload).grantId,appCredentials:APP,fetchImpl:gh.fetchImpl}),
  /readback-not-found/);
 assert.equal(gh.posts('/git/refs'),0);
 assert.equal((await state(h.db))[0].state,'reconcile_required');
});

async function reservedGrant(t){
 const h=await prepared(t),envelope=await sign(h.ownerGrantRequest);
 const verified=await adjudicator.verifyDelegatedGrant({envelope,publicJwk,
  request:canary.branchGrantRequest(h.prepared)});
 const reservation=await adjudicator.reserveBranchExecution({db:h.db,verifiedGrant:verified,
  idempotencyKey:'ultron-task-'+h.prepared.taskId,targetBranch:h.prepared.branch,
  operationDigest:h.prepared.planSha256});
 assert.equal(reservation.ok,true);
 const intent={idempotencyKey:'ultron-task-'+h.prepared.taskId,
  operationDigest:h.prepared.planSha256,repository:REPO,
  targetBranch:h.prepared.branch,personaRole:'builder'};
 return {...h,verified,intent};
}

test('authorization.verify returns the durable-executor proof and fails closed on mismatch or expiry',async t=>{
 const h=await reservedGrant(t);
 const verifier=canary.createBranchAuthorizationVerifier({db:h.db,verifiedGrant:h.verified});
 const proof=await verifier.verify(h.intent);
 assert.deepEqual(Object.keys(proof).sort(),
  ['expiresAt','operationDigest','personaRole','repository','targetBranch','verified']);
 assert.equal(proof.verified,true);
 assert.equal(proof.expiresAt,new Date(h.verified.expiresAt).toISOString());
 await assert.rejects(verifier.verify({...h.intent,operationDigest:'0'.repeat(64)}),/authorization-rejected/);
 await assert.rejects(verifier.verify({...h.intent,targetBranch:'ultron/canary-other'}),/authorization-rejected/);
 await assert.rejects(verifier.verify({...h.intent,personaRole:'skeptic'}),/authorization-rejected/);
 const forged=canary.createBranchAuthorizationVerifier({db:h.db,verifiedGrant:{...h.verified}});
 await assert.rejects(forged.verify(h.intent),/authorization-rejected/);
 const later=canary.createBranchAuthorizationVerifier({db:h.db,verifiedGrant:h.verified,
  clock:()=>Date.parse(h.verified.expiresAt)+1});
 await assert.rejects(later.verify(h.intent),/authorization-rejected/);
 await h.db.query(`UPDATE brain_owner_autonomy_profile SET version=version+1 WHERE id=1`);
 await assert.rejects(verifier.verify(h.intent),/authorization-rejected/);
});

test('authorization adapter satisfies the src durable-executor contract on a grant-bound row',async t=>{
 const h=await reservedGrant(t);
 let remote='absent',writes=0;
 const receipt=await executeIdempotentGitHubWrite({taskId:h.prepared.taskId,
  targetBranch:h.prepared.branch,sourceSha:SOURCE,operationDigest:h.prepared.planSha256},
 'scoped-test-token',{role:'builder'},async()=>{writes++;remote='matched';},{db:h.db,
  authorization:canary.createBranchAuthorizationVerifier({db:h.db,verifiedGrant:h.verified}),
  remote:{inspect:async()=>remote==='matched'?{state:'matched',sha:'c'.repeat(40)}:{state:'absent'}}});
 assert.equal(receipt.status,'success');
 assert.equal(writes,1);
 assert.equal((await state(h.db))[0].grant_id,h.verified.grantId);
});

test('0044 permits grant-bound branch rows only for a matching repair.branch.create grant',async t=>{
 const db=await database(t);
 const digest='d'.repeat(64),branch='ultron/canary-migration';
 const insert=(key,grant,target=branch)=>db.query(`INSERT INTO github_idempotent_executions(
  idempotency_key,operation_digest,repository,target_kind,target_branch,grant_id,persona_role)
  VALUES($1,$2,$3,'branch',$4,$5,'builder')`,[key,digest,REPO,target,grant]);
 const grant=(id,operation,resource)=>db.query(`INSERT INTO brain_authority_grants(
  grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
  VALUES($1,'objective',$2,$3,$4,$5,now()+interval '5 minutes')`,
 [id,'worker:builder',operation,resource,'a'.repeat(64)]);
 await insert('ultron-task-historical',null,'ultron/canary-historical');
 await grant('grant-pr-comment-1','pr.comment',`github:branch:${REPO}:${branch}:sha256:${digest}`);
 await assert.rejects(insert('ultron-task-wrong-op','grant-pr-comment-1'),/branch-grant-unbound/);
 await grant('grant-branch-other','repair.branch.create',`github:branch:${REPO}:ultron/canary-x:sha256:${digest}`);
 await assert.rejects(insert('ultron-task-wrong-res','grant-branch-other'),/branch-grant-unbound/);
 await grant('grant-branch-ok','repair.branch.create',`github:branch:${REPO}:${branch}:sha256:${digest}`);
 await insert('ultron-task-bound','grant-branch-ok');
 await assert.rejects(db.query(`UPDATE github_idempotent_executions SET grant_id=NULL
  WHERE idempotency_key='ultron-task-bound'`),/transition-denied/);
 await assert.rejects(db.query(`INSERT INTO github_idempotent_executions(
  idempotency_key,operation_digest,repository,target_kind,target_branch,body_sha256,persona_role)
  VALUES('ultron-task-shape',$1,$2,'branch','ultron/canary-shape',$1,'builder')`,[digest,REPO]),
  /target_shape_check/);
 await assert.rejects(db.query(`INSERT INTO github_idempotent_executions(
  idempotency_key,operation_digest,repository,target_kind,target_number,body_sha256,persona_role)
  VALUES('ultron-task-pr-nogrant',$1,$2,'pull_request_comment',7,$1,'builder')`,[digest,REPO]),
  /target_shape_check/);
 const ops=Array.from({length:24},(_,i)=>'op.'+i);
 await db.query(`UPDATE brain_owner_autonomy_profile SET allowed_operations=$1::jsonb WHERE id=1`,
  [JSON.stringify(ops)]);
 await assert.rejects(db.query(`UPDATE brain_owner_autonomy_profile SET allowed_operations=$1::jsonb WHERE id=1`,
  [JSON.stringify([...ops,'op.24'])]),/allowed_operations_check/);
});

test('Task 5 audit reports providerReadbackStatus mismatch or unavailable and fails closed',async t=>{
 const db=await database(t);
 const receipt={idempotencyKey:'ultron-task-hb-'+'a'.repeat(24),status:'success',details:{
  repository:REPO,branch:'ultron/canary-hb-'+'a'.repeat(24),operationDigest:'d'.repeat(64),
  sha:'c'.repeat(40),remoteVerified:true,personaRole:'builder'}};
 const cases=[[()=>{throw Error('canary-remote-lineage-invalid');},'mismatch'],
  [()=>{throw Error('canary-remote-lineage-unavailable');},'unavailable'],
  [()=>{throw Error('github-branch-canary-token-exchange-denied');},'unavailable']];
 for(const [readback,status] of cases){
  const audit=canary.createBranchAuditRecorder({db,sourceSha:SOURCE,readback});
  await assert.rejects(audit(receipt),new RegExp('audit-readback-'+status+'$'));
 }
 const held=(await db.query(`SELECT details FROM brain_events
  WHERE event_type='github-branch-canary-audit-held' ORDER BY id`)).rows;
 assert.deepEqual(held.map(r=>r.details.providerReadbackStatus),['mismatch','unavailable','unavailable']);
 assert.ok(held.every(r=>r.details.remoteReadbackVerified===false));
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM brain_events
  WHERE event_type='github-branch-canary-audited'`)).rows[0].n,0);
 const ok=await canary.createBranchAuditRecorder({db,sourceSha:SOURCE,readback:async()=>({})})(receipt);
 assert.equal(ok.providerReadbackStatus,'matched');
});
