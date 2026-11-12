import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {verifyDelegatedGrant,reservePrCommentExecution}
 from '../cloud/hatchable/lib/security-adjudicator.js';
const canarySource=(await readFile(new URL('../cloud/hatchable/lib/github-pr-comment-canary.js',
 import.meta.url),'utf8')).replace("'lib/rsa-pkcs1-sign.js'",
 JSON.stringify(new URL('../cloud/hatchable/lib/rsa-pkcs1-sign.js',import.meta.url).href));
const {preparePrCommentCanary,operationDigest,submitPrCommentCanary,
 reconcilePrCommentCanary,classifyPrCommentFailure}=await import('data:text/javascript;base64,'+
 Buffer.from(canarySource).toString('base64'));

const MIGRATIONS=['0001_tasks.sql','0002_events.sql','0008_admin_grants.sql',
 '0010_runtime_stop.sql','0013_continuum_outbox.sql',
 '0016_owner_autonomy_profile.sql','0033_owner_passkey_authority.sql',
 '0034_owner_passkey_enrollment.sql','0037_github_approval_nonces.sql',
 '0039_github_idempotent_executions.sql',
 '0041_github_pr_comment_executions.sql'];
const RSA=generateKeyPairSync('rsa',{modulusLength:2048});
const APP={appId:'5633654',installationId:'179066535',
 privateKey:RSA.privateKey.export({format:'pem',type:'pkcs1'}).toString()};
const subtle=webcrypto.subtle;
const response=(status,body)=>({status,ok:status>=200&&status<300,
 json:async()=>structuredClone(body)});
async function database(t,{passkey=true}={}){
 const db=new PGlite();
 for(const migration of MIGRATIONS)await db.exec(await readFile(
  new URL('../cloud/hatchable/migrations/'+migration,import.meta.url),'utf8'));
 await db.query(`UPDATE brain_owner_autonomy_profile SET preset='release',version=7
  WHERE id=1`);
 await db.query(`UPDATE brain_runtime_control SET version=5 WHERE id=1`);
 if(passkey){
  await db.query(`INSERT INTO brain_authority_grants(
   grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
   VALUES('owner-passkey-bootstrap-test','owner-passkey-test','michaeljwilliams0123',
    'owner.passkey.enroll','sha256:${'a'.repeat(64)}','${'b'.repeat(64)}',
    now()+interval '1 hour')`);
  await db.query(`INSERT INTO brain_owner_passkeys(
   credential_id,public_key_spki,label,enrollment_key,enrollment_fingerprint,
   enrolled_grant_id) VALUES($1,$2,'Test owner passkey','owner-passkey-test',
   $3,'owner-passkey-bootstrap-test')`,[
    'credential-'+'c'.repeat(32),'d'.repeat(120),'e'.repeat(64)]);
 }
 t.after(()=>db.close());
 return db;
}
async function signed(prepared){
 const pair=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,
  ['sign','verify']);
 const now=Date.now(),request=prepared.ownerGrantRequest;
 const grant={schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
  authorizedBy:'michaeljwilliams0123',audience:'ultron-cloud-brain',
  grantId:'owner-c04-'+crypto.randomUUID(),policySha:request.policySha,
  notBefore:new Date(now-1000).toISOString(),
  expiresAt:new Date(now+240000).toISOString(),actor:request.actor,
  objectiveId:request.objectiveId,operation:request.operation,
  resource:request.resource,administrativeChange:false,
  profileVersion:request.profileVersion,stopVersion:request.stopVersion};
 const payload=JSON.stringify(grant);
 const signature=Buffer.from(await subtle.sign({name:'ECDSA',hash:'SHA-256'},
  pair.privateKey,new TextEncoder().encode(payload))).toString('base64url');
 const envelope={payload,signature};
 const verified=await verifyDelegatedGrant({envelope,
  publicJwk:await subtle.exportKey('jwk',pair.publicKey),request:{
   actor:request.actor,objectiveId:request.objectiveId,operation:request.operation,
   resource:request.resource,administrativeChange:false}});
 return {envelope,verified};
}
function comment(prepared,id=6783990001){
 return {id,body:prepared.commentBody,
  html_url:`https://github.com/michaeljwilliams0123/Ultron.MW/pull/${prepared.pullRequest}#issuecomment-${id}`,
  user:{login:'ultron-coordinator[bot]',id:353078104,type:'Bot'},
  performed_via_github_app:{id:5633654,slug:'ultron-coordinator'}};
}
function provider(prepared,{lost=false}={}){
 const calls=[];let created=null;
 const fetchImpl=async(url,options={})=>{
  const method=options.method||'GET';calls.push({url,method,body:options.body,
   authorization:options.headers?.Authorization});
  if(url.endsWith('/app/installations/179066535/access_tokens')){
   const body=JSON.parse(options.body);
   assert.deepEqual(body,{repository_ids:[1424939667],
    permissions:{issues:'write',metadata:'read'}});
   return response(201,{token:'test-scoped-token',permissions:body.permissions,
    repositories:[{id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'}],
    expires_at:new Date(Date.now()+1800000).toISOString()});
  }
  if(method==='POST'&&url.endsWith(`/issues/${prepared.pullRequest}/comments`)){
   assert.deepEqual(JSON.parse(options.body),{body:prepared.commentBody});
   created=comment(prepared);
   if(lost)throw Error('lost response after commit');
   return response(201,created);
  }
  if(method==='GET'&&url.includes(`/issues/${prepared.pullRequest}/comments?`)){
   assert.doesNotMatch(url,/[?&](sort|direction)=/);
   return response(200,created?[created]:[]);
  }
  if(method==='GET'&&url.endsWith('/issues/comments/6783990001'))
   return response(200,created);
  throw Error('unexpected '+method+' '+url);
 };
 return {fetchImpl,calls,get created(){return created;}};
}
async function admitted(t){
 const db=await database(t),prepared=await preparePrCommentCanary({db,pullRequest:398});
 const {verified,envelope}=await signed(prepared),digest=operationDigest(prepared,verified.grantId);
 const reservation=await reservePrCommentExecution({db,verifiedGrant:verified,
  idempotencyKey:prepared.idempotencyKey,pullRequest:prepared.pullRequest,
  bodySha256:prepared.bodySha256,operationDigest:digest});
 assert.equal(reservation.ok,true);
 return {db,prepared,verified,envelope,digest};
}

test('owner-signed Coordinator comment completes with independent readback and one durable receipt',async t=>{
 const h=await admitted(t),github=provider(h.prepared);
 const result=await submitPrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,appCredentials:APP,fetchImpl:github.fetchImpl});
 assert.equal(result.status,'success');
 assert.equal(result.receipt.details.remoteVerified,true);
 assert.equal(result.receipt.details.appId,5633654);
 assert.equal(github.calls.filter(call=>call.method==='POST'&&
  call.url.endsWith('/comments')).length,1);
 const counts=(await h.db.query(`SELECT
  (SELECT count(*)::int FROM brain_github_approval_nonces) AS nonces,
  (SELECT count(*)::int FROM brain_authority_grants
   WHERE operation='pr.comment') AS grants,
  (SELECT count(*)::int FROM github_pr_comment_executions) AS executions`)).rows[0];
 assert.deepEqual(counts,{nonces:1,grants:1,executions:1});
 const replay=await reservePrCommentExecution({db:h.db,verifiedGrant:h.verified,
  idempotencyKey:h.prepared.idempotencyKey,pullRequest:h.prepared.pullRequest,
  bodySha256:h.prepared.bodySha256,operationDigest:h.digest});
 assert.deepEqual(replay,{ok:false,error:'execution-already-reserved',status:'completed'});
 assert.equal(github.calls.filter(call=>call.method==='POST'&&
  call.url.endsWith('/comments')).length,1);
});

test('reservation requires an active owner passkey without consuming authority',async t=>{
 const db=await database(t,{passkey:false});
 const prepared=await preparePrCommentCanary({db,pullRequest:398});
 const {verified}=await signed(prepared),digest=operationDigest(prepared,verified.grantId);
 const reservation=await reservePrCommentExecution({db,verifiedGrant:verified,
  idempotencyKey:prepared.idempotencyKey,pullRequest:prepared.pullRequest,
  bodySha256:prepared.bodySha256,operationDigest:digest});
 assert.deepEqual(reservation,{ok:false,error:'owner-passkey-required'});
 const counts=(await db.query(`SELECT
  (SELECT count(*)::int FROM brain_github_approval_nonces) AS nonces,
  (SELECT count(*)::int FROM brain_authority_grants
   WHERE operation='pr.comment') AS grants,
  (SELECT count(*)::int FROM github_pr_comment_executions) AS executions`)).rows[0];
 assert.deepEqual(counts,{nonces:0,grants:0,executions:0});
});

test('lost POST response is reconciled by public readback without a second write',async t=>{
 const h=await admitted(t),github=provider(h.prepared,{lost:true});
 await assert.rejects(submitPrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,appCredentials:APP,fetchImpl:github.fetchImpl}),
  /provider-outcome-unknown/);
 assert.equal((await h.db.query(`SELECT state FROM github_pr_comment_executions`))
  .rows[0].state,'reconcile_required');
 const result=await reconcilePrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,fetchImpl:github.fetchImpl});
 assert.equal(result.status,'reconciled_success');
 assert.equal(github.calls.filter(call=>call.method==='POST'&&
  call.url.endsWith('/comments')).length,1);
});

const SCHEMA_SNAPSHOT=`SELECT
 (SELECT json_agg(json_build_array(column_name,data_type,is_nullable,column_default)
   ORDER BY ordinal_position) FROM information_schema.columns
   WHERE table_name='github_idempotent_executions') AS columns,
 (SELECT json_agg(json_build_array(constraint_name,check_clause) ORDER BY constraint_name)
   FROM information_schema.check_constraints
   WHERE constraint_name LIKE 'github_idempotent_executions%') AS checks,
 (SELECT json_agg(json_build_array(constraint_name,constraint_type) ORDER BY constraint_name)
   FROM information_schema.table_constraints
   WHERE table_name='github_idempotent_executions') AS constraints`;
async function migrated(t,names){
 const db=new PGlite();
 for(const migration of names)await db.exec(await readFile(
  new URL('../cloud/hatchable/migrations/'+migration,import.meta.url),'utf8'));
 t.after(()=>db.close());
 return db;
}

test('0041 is additive: the 0039 branch ledger is unchanged and existing rows stay valid and immutable',async t=>{
 const before=MIGRATIONS.slice(0,-1);
 assert.equal(MIGRATIONS.at(-1),'0041_github_pr_comment_executions.sql');
 assert.equal(MIGRATIONS.includes('0040_ultron_org_transfer.sql'),false,'0041 must not need 0040');
 const db=await migrated(t,before);
 const digest=createHash('sha256').update('branch').digest('hex');
 const receipt={idempotencyKey:'ultron-task-historical',status:'success',details:{
  repository:'michaeljwilliams0123/Ultron.MW',branch:'ultron/canary-old',
  operationDigest:digest,sha:'a'.repeat(40),remoteVerified:true,
  personaRole:'builder'}};
 await db.query(`INSERT INTO github_idempotent_executions(
  idempotency_key,operation_digest,repository,target_branch,persona_role,state,receipt)
  VALUES('ultron-task-historical',$1,'michaeljwilliams0123/Ultron.MW',
   'ultron/canary-old','builder','completed',$2::jsonb)`,[digest,JSON.stringify(receipt)]);
 const snapshot=(await db.query(SCHEMA_SNAPSHOT)).rows[0];
 const sql=await readFile(new URL('../cloud/hatchable/migrations/0041_github_pr_comment_executions.sql',
  import.meta.url),'utf8');
 await db.exec(sql);
 await db.exec(sql); // idempotent re-run
 assert.deepEqual((await db.query(SCHEMA_SNAPSHOT)).rows[0],snapshot);
 assert.deepEqual((await db.query('SELECT state,receipt FROM github_idempotent_executions')).rows,
  [{state:'completed',receipt}]);
 await assert.rejects(db.query(`UPDATE github_idempotent_executions
  SET target_branch='ultron/canary-changed' WHERE idempotency_key='ultron-task-historical'`),
  /immutable|transition/i);
 // Branch rows still need a branch; the 0039 contract is not relaxed.
 await assert.rejects(db.query(`INSERT INTO github_idempotent_executions(
  idempotency_key,operation_digest,repository,target_branch,persona_role)
  VALUES('ultron-task-nobranch',$1,'michaeljwilliams0123/Ultron.MW',NULL,'builder')`,[digest]),
  /null/i);
});

test('0041 source never alters, drops or rewrites pre-existing objects',async()=>{
 const sql=(await readFile(new URL('../cloud/hatchable/migrations/0041_github_pr_comment_executions.sql',
  import.meta.url),'utf8')).replace(/--.*$/gm,'');
 assert.doesNotMatch(sql,/\bALTER\s+\w+|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bINSERT\s+INTO\b/i);
 assert.doesNotMatch(sql,/github_idempotent_executions/);
 for(const m of sql.matchAll(/\bDROP\s+(\w+)\s+(?:IF\s+EXISTS\s+)?(\w+)/gi))
  assert.deepEqual([m[1].toUpperCase(),m[2]],['TRIGGER','github_pr_comment_executions_guard_trg']);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS github_pr_comment_executions/);
});

test('comment ledger rejects foreign repositories, deletes and identity changes',async t=>{
 const h=await admitted(t);
 await assert.rejects(h.db.query(`DELETE FROM github_pr_comment_executions`),/immutable/);
 await assert.rejects(h.db.query(`UPDATE github_pr_comment_executions SET target_number=target_number+1`),
  /transition/);
 await assert.rejects(h.db.query(`UPDATE github_pr_comment_executions SET state='completed'`),
  /check|violat/i);
 const grant=(await h.db.query('SELECT grant_id FROM github_pr_comment_executions')).rows[0].grant_id;
 await assert.rejects(h.db.query(`INSERT INTO github_pr_comment_executions(
  idempotency_key,operation_digest,repository,target_number,body_sha256,grant_id)
  VALUES('ultron-task-c04-pr9-${'0'.repeat(24)}','${'1'.repeat(64)}','Ultron-MW/Ultron.MW',9,
   '${'2'.repeat(64)}',$1)`,[grant]),/check|violat/i);
});

test('provider writes and readbacks carry the scoped installation token',async t=>{
 const h=await admitted(t),github=provider(h.prepared);
 await submitPrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,appCredentials:APP,fetchImpl:github.fetchImpl});
 const [exchange,...rest]=github.calls;
 assert.match(exchange.authorization,/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
 assert.deepEqual(rest.map(c=>[c.method,c.authorization]),
  [['POST','Bearer test-scoped-token'],['GET','Bearer test-scoped-token']]);
});

test('reconcile with App credentials reads with the token, scoped to after the reservation',async t=>{
 const h=await admitted(t),github=provider(h.prepared,{lost:true});
 await assert.rejects(submitPrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,appCredentials:APP,fetchImpl:github.fetchImpl}));
 const before=github.calls.length;
 const result=await reconcilePrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,appCredentials:APP,fetchImpl:github.fetchImpl});
 assert.equal(result.status,'reconciled_success');
 const calls=github.calls.slice(before);
 assert.match(calls[0].url,/\/access_tokens$/);
 const list=calls.find(c=>c.url.includes('/comments?'));
 const since=new URL(list.url).searchParams.get('since');
 const reserved=(await h.db.query('SELECT created_at FROM github_pr_comment_executions')).rows[0].created_at;
 assert.equal(Date.parse(since),new Date(reserved).getTime()-60000);
 for(const c of calls.slice(1))assert.equal(c.authorization,'Bearer test-scoped-token');
 assert.equal(github.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/comments')).length,1);
});

test('token exchange accepts GitHub expiry stamped after our clock read, within bounded skew',async t=>{
 const now=1_800_000_000_000;
 const attempt=async expiresAt=>{
  const h=await admitted(t);
  const fetchImpl=async(url,options={})=>{
   if(url.endsWith('/access_tokens'))return response(201,{token:'test-scoped-token',
    permissions:{issues:'write',metadata:'read'},
    repositories:[{id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'}],
    expires_at:new Date(expiresAt).toISOString()});
   throw Error('stop-after-exchange');
  };
  return submitPrCommentCanary({db:h.db,prepared:h.prepared,operationDigest:h.digest,
   appCredentials:APP,fetchImpl,clock:()=>now}).then(()=>'ok',e=>e.message);
 };
 // Real GitHub responses: server time + 3600s, a few hundred ms after our read.
 assert.doesNotMatch(await attempt(now+3600000+850),/token-response-invalid/);
 assert.doesNotMatch(await attempt(now+3600000+4*60000),/token-response-invalid/);
 assert.match(await attempt(now+3600000+6*60000),/token-response-invalid/);
 assert.match(await attempt(now-1000),/token-response-invalid/);
});


test('C04 failure classification is bounded to fixed safe reason codes and dispatch status',()=>{
 assert.deepEqual(classifyPrCommentFailure(new Error('github-pr-comment-canary-token-exchange-denied')),
  {stage:'credential_exchange',reason:'token-exchange-denied',dispatched:false});
 assert.deepEqual(classifyPrCommentFailure(new Error('github-pr-comment-canary-provider-outcome-unknown')),
  {stage:'provider_write',reason:'provider-outcome-unknown',dispatched:null});
 assert.deepEqual(classifyPrCommentFailure(new Error('github-pr-comment-canary-readback-not-found')),
  {stage:'provider_readback',reason:'readback-not-found',dispatched:null});
 const secret='Bearer super-secret-token';
 assert.deepEqual(classifyPrCommentFailure(new Error(secret)),
  {stage:'unknown',reason:'unclassified',dispatched:null});
 assert.doesNotMatch(JSON.stringify(classifyPrCommentFailure(new Error(secret))),/super-secret/);
});

test('token exchange denial records a pre-dispatch failure without any provider write intent',async t=>{
 const h=await admitted(t);
 const calls=[];
 const fetchImpl=async(url,options={})=>{
  calls.push({url,method:options.method||'GET'});
  if(url.endsWith('/access_tokens'))return response(403,{message:'private-value-not-for-logs'});
  throw Error('effect-not-allowed');
 };
 await assert.rejects(submitPrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,appCredentials:APP,fetchImpl}),/token-exchange-denied/);
 const events=(await h.db.query("SELECT details FROM brain_events WHERE event_type='github-pr-comment-stage' ORDER BY id"))
  .rows.map(row=>row.details);
 assert.ok(events.some(e=>e.stage==='credential_exchange_failed' &&
  e.reason==='token-exchange-denied' && e.idempotencyKey===h.prepared.idempotencyKey));
 assert.equal(events.some(e=>e.stage==='provider_write_intent'),false);
 assert.deepEqual(calls.map(c=>c.method),['POST']);
 assert.equal((await h.db.query('SELECT state FROM github_pr_comment_executions')).rows[0].state,'reserved');
 assert.doesNotMatch(JSON.stringify(events),/private-value-not-for-logs/);
});

test('lost provider acknowledgment persists exact write intent and unresolved stage, never retries POST',async t=>{
 const h=await admitted(t),github=provider(h.prepared,{lost:true});
 await assert.rejects(submitPrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,appCredentials:APP,fetchImpl:github.fetchImpl}),
  /provider-outcome-unknown/);
 const events=(await h.db.query("SELECT details FROM brain_events WHERE event_type='github-pr-comment-stage' ORDER BY id"))
  .rows.map(row=>row.details);
 assert.ok(events.some(e=>e.stage==='provider_write_intent'));
 assert.ok(events.some(e=>e.stage==='reconcile_required' && e.reason==='provider-outcome-unknown'));
 assert.equal(events.every(e=>e.idempotencyKey===h.prepared.idempotencyKey),true);
 assert.equal(github.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/comments')).length,1);
 const recovered=await reconcilePrCommentCanary({db:h.db,prepared:h.prepared,
  operationDigest:h.digest,fetchImpl:github.fetchImpl});
 assert.equal(recovered.status,'reconciled_success');
 assert.equal(github.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/comments')).length,1);
});
