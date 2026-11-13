import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign} from 'node:crypto';
import {CouncilAttestationVerifier} from '../src/security/council-verifier.js';
import {DurableOutboxHandler} from '../src/core/durable-outbox-handler.js';

let PGlite;
try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
if(process.env.CI==='true'&&!PGlite)throw Error('PGlite required for UUAM CI');
const skip=PGlite?false:'PGlite unavailable outside CI';
const read=name=>readFile(new URL(
  '../cloud/hatchable/migrations/'+name,import.meta.url),'utf8');

const DIGEST='a'.repeat(64);
const PAYLOAD=Buffer.from('{"event":"bounded-uuam-canary"}');
const TASK='ultron-task-uuam-acceptance-001';
const SOURCE='github';
const DELIVERY='uuam-delivery-001';
const KEYS=Array.from({length:7},(_,index)=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  return {id:'council-'+(index+1),privateKey,
    publicKeyPem:publicKey.export({type:'spki',format:'pem'})};
});
const council=new CouncilAttestationVerifier({
  members:KEYS,threshold:7,policyVersion:'v1',
  allowedOperations:['pr.comment']
});
const makeIntent=()=>({repo:'michaeljwilliams0123/Ultron.MW',
  operation:'pr.comment',planDigest:DIGEST,ownerGrantHash:'b'.repeat(64),
  nonce:'c'.repeat(32),expiresAt:Date.now()+120000,policyVersion:'v1'});
const votes=intent=>{
  const bytes=Buffer.from(JSON.stringify([
    'UUAM-COUNCIL-V1',intent.repo,intent.operation,intent.planDigest,
    intent.ownerGrantHash,intent.nonce,intent.expiresAt,intent.policyVersion]));
  return KEYS.map(key=>({
    signerId:key.id,
    signature:sign(null,bytes,key.privateKey).toString('base64url')
  }));
};
const envelope=()=>({source:SOURCE,deliveryId:DELIVERY,taskKey:'task-uuam-001',
  rawBody:PAYLOAD,operationDigest:DIGEST,githubIdempotencyKey:TASK,
  signatureHeaders:{'x-hub-signature-256':'test-fixture'}});
const setup=async()=>{
  const db=new PGlite();
  for(const migration of ['0008_admin_grants.sql','0009_signed_event_inbox.sql',
    '0039_github_idempotent_executions.sql','0047_omni_state_machine.sql'])
    await db.exec(await read(migration));
  return db;
};
const handler=(db,changes={})=>new DurableOutboxHandler({
  db,councilVerifier:council,
  verifyIngress:async()=>true,
  verifyOwnerGrant:async({intent})=>({
    authorized:true,grantId:'uuam-grant-001',grantHash:intent.ownerGrantHash
  }),
  verifyRemote:async()=>true,...changes
});
const insertGrant=async(db,expires="now()+interval '5 minutes'")=>
  db.query("INSERT INTO brain_authority_grants "+
    "(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at) "+
    "VALUES($1,'uuam-canary','mcp:ultron','pr.comment',$2,$3,"+expires+")",
    ['uuam-grant-001',
     'ultron:github:michaeljwilliams0123/Ultron.MW:sha256:'+DIGEST,
     'f'.repeat(64)]);

test('0047 is additive to existing inbox/receipt tables, not another ledger',async()=>{
  const sql=await read('0047_omni_state_machine.sql');
  assert.match(sql,/REFERENCES brain_signed_inbox\(id\)/);
  assert.match(sql,/github_idempotent_executions/);
  assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS omni_event_ledger/i);
  assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS admin_passkeys/i);
  assert.doesNotMatch(sql,/DROP TABLE/i);
});
test('0047 migration replays idempotently on a real PostgreSQL engine',{skip},async()=>{
  const db=await setup();
  try{
    await db.exec(await read('0047_omni_state_machine.sql'));
    const rows=(await db.query("SELECT table_name FROM information_schema.tables "+
      "WHERE table_name='brain_omni_execution_state'")).rows;
    assert.equal(rows.length,1);
  }finally{await db.close();}
});
test('verified delivery is persisted once and conflicting replay rejected',{skip},async()=>{
  const db=await setup();
  try{
    const service=handler(db);
    const first=await service.ingestEvent(envelope());
    assert.equal(first.state,'PERSISTED');
    assert.equal(first.reused,false);
    const duplicate=await service.ingestEvent(envelope());
    assert.equal(duplicate.inboxId,first.inboxId);
    assert.equal(duplicate.reused,true);
    await assert.rejects(service.ingestEvent({
      ...envelope(),rawBody:Buffer.from('tampered')
    }),/conflicting/i);
    await assert.rejects(service.ingestEvent({
      ...envelope(),operationDigest:'d'.repeat(64)
    }),/conflicting/i);
    await assert.rejects(service.ingestEvent({
      ...envelope(),githubIdempotencyKey:'ultron-task-other'
    }),/conflicting/i);
    const count=(await db.query('SELECT count(*)::int AS n FROM brain_signed_inbox')).rows[0].n;
    assert.equal(count,1);
  }finally{await db.close();}
});
test('unverified ingress cannot enter the durable inbox',{skip},async()=>{
  const db=await setup();
  try{
    await assert.rejects(
      handler(db,{verifyIngress:async()=>false}).ingestEvent(envelope()),
      /ingress signature rejected/);
    assert.equal((await db.query(
      'SELECT count(*)::int AS n FROM brain_signed_inbox')).rows[0].n,0);
  }finally{await db.close();}
});
test('Council requires 7/7 and owner verification before authorization',{skip},async()=>{
  const db=await setup();
  try{
    await insertGrant(db);
    const service=handler(db);
    const {inboxId}=await service.ingestEvent(envelope());
    const intent=makeIntent();
    await assert.rejects(service.authorizeEvent({
      inboxId,intent,signatures:votes(intent).slice(0,6)
    }),/Council attestation rejected/);
    await assert.rejects(handler(db,{verifyOwnerGrant:async()=>false})
      .authorizeEvent({inboxId,intent,signatures:votes(intent)}),
      /owner grant not independently verified/);
    assert.equal((await db.query(
      'SELECT state FROM brain_omni_execution_state WHERE inbox_id=$1',
      [inboxId])).rows[0].state,'PERSISTED');
    assert.equal((await service.authorizeEvent({
      inboxId,intent,signatures:votes(intent)})).state,'AUTHORIZED');
    await assert.rejects(service.authorizeEvent({
      inboxId,intent,signatures:votes(intent)}),/state or plan mismatch/);
  }finally{await db.close();}
});
test('SQL itself denies expired grants and unauthorized direct transitions',{skip},async()=>{
  const db=await setup();
  try{
    await insertGrant(db,"now()-interval '1 minute'");
    const service=handler(db);
    const {inboxId}=await service.ingestEvent(envelope());
    const intent=makeIntent();
    await assert.rejects(service.authorizeEvent({
      inboxId,intent,signatures:votes(intent)
    }),/omni-owner-authorization-unverified/);
    await assert.rejects(db.query(
      "UPDATE brain_omni_execution_state SET state='VERIFIED',"+
      "verified_at=clock_timestamp() WHERE inbox_id=$1",[inboxId]
    ),/omni-state-transition-denied/);
    await assert.rejects(db.query(
      'DELETE FROM brain_omni_execution_state WHERE inbox_id=$1',[inboxId]
    ),/omni-state-immutable/);
  }finally{await db.close();}
});
test('remote readback and existing completed receipt are mandatory for VERIFIED',{skip},async()=>{
  const db=await setup();
  try{
    await insertGrant(db);
    const service=handler(db),intent=makeIntent();
    const {inboxId}=await service.ingestEvent(envelope());
    await service.authorizeEvent({inboxId,intent,signatures:votes(intent)});
    await assert.rejects(service.markDispatched(inboxId,{
      leaseOwner:'test-worker-01',leaseExpiresAt:new Date(Date.now()-1000)
    }),/invalid dispatch lease/);
    await service.markDispatched(inboxId,{
      leaseOwner:'test-worker-01',leaseExpiresAt:new Date(Date.now()+120000)
    });
    await assert.rejects(service.markVerified(inboxId),
      /omni-independent-readback-required/);
    await db.query("INSERT INTO github_idempotent_executions"+
      "(idempotency_key,operation_digest,repository,target_branch,persona_role) "+
      "VALUES($1,$2,'michaeljwilliams0123/Ultron.MW','uuam-canary','builder')",
      [TASK,DIGEST]);
    await db.query("UPDATE github_idempotent_executions SET state='in_flight' "+
      'WHERE idempotency_key=$1',[TASK]);
    const receipt={idempotencyKey:TASK,status:'success',details:{
      operationDigest:DIGEST,branch:'uuam-canary',
      repository:'michaeljwilliams0123/Ultron.MW',personaRole:'builder',
      remoteVerified:true,sha:'e'.repeat(40)}};
    await db.query("UPDATE github_idempotent_executions SET "+
      "state='completed',receipt=$2::jsonb WHERE idempotency_key=$1",
      [TASK,JSON.stringify(receipt)]);
    await assert.rejects(handler(db,{verifyRemote:async()=>false})
      .markVerified(inboxId),/independent remote readback missing/);
    assert.equal((await service.markVerified(inboxId)).state,'VERIFIED');
    await assert.rejects(service.markVerified(inboxId),
      /omni-state-terminal-immutable|verification transition denied/);
    await assert.rejects(db.query(
      "UPDATE brain_omni_execution_state SET operation_digest=$2 "+
      'WHERE inbox_id=$1',[inboxId,'b'.repeat(64)]),
      /omni-state-terminal-immutable/);
  }finally{await db.close();}
});
test('unknown write outcome enters reconciliation rather than blind retry',{skip},async()=>{
  const db=await setup();
  try{
    await insertGrant(db);
    const service=handler(db),intent=makeIntent();
    const {inboxId}=await service.ingestEvent(envelope());
    await service.authorizeEvent({inboxId,intent,signatures:votes(intent)});
    await service.markDispatched(inboxId,{
      leaseOwner:'test-worker-01',leaseExpiresAt:new Date(Date.now()+120000)
    });
    const result=await service.markReconcileRequired(inboxId);
    assert.equal(result.state,'RECONCILE_REQUIRED');
    const current=(await db.query(
      'SELECT state,retry_count FROM brain_omni_execution_state WHERE inbox_id=$1',
      [inboxId])).rows[0];
    assert.equal(current.retry_count,1);
    await assert.rejects(service.markDispatched(inboxId,{
      leaseOwner:'test-worker-01',leaseExpiresAt:new Date(Date.now()+120000)
    }),/dispatch state denied/);
  }finally{await db.close();}
});
