import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createOmniShadowMachine,authorizationMessage} from '../src/omni-shadow-state-machine.mjs';
import {canonicalJson} from '../src/git-hubs.mjs';

const REPO='michaeljwilliams0123/Ultron.MW',SHA='a'.repeat(40);
const payload={kind:'research.plan',objective:'verify read-only shadow lifecycle',meta:{attempt:1,scope:'sandbox'}};
const hash=x=>createHash('sha256').update(canonicalJson(x)).digest('hex');

async function fixture(){
 const db=new PGlite();
 for(const file of ['0008_admin_grants.sql','0047_omni_state_machine.sql'])
  await db.exec(await readFile(new URL('../cloud/hatchable/migrations/'+file,import.meta.url),'utf8'));
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 return {db,privateKey,machine:createOmniShadowMachine({db,ownerPublicJwk:publicKey.export({format:'jwk'})}),close:()=>db.close()};
}
function signGrant(f,event,overrides={}){
 const grant={v:1,eventId:event.id,nonce:event.nonce,payloadSha256:event.payloadSha256,
  repository:event.repository,sourceSha:event.sourceSha,grantId:'omni-shadow-owner-grant-0001',
  actor:'mcp:ultron',operation:'omni.shadow.authorize',
  expiresAt:new Date(Date.now()+180000).toISOString(),...overrides};
 return {...grant,signature:sign('sha256',Buffer.from(authorizationMessage(grant)),f.privateKey).toString('base64url')};
}
async function grantRow(f,event,grant){
 await f.db.query("INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at) VALUES($1,'omni-test','mcp:ultron','omni.shadow.authorize',$2,$3,$4)",
 [grant.grantId,'omni-event:'+event.id+':sha256:'+event.payloadSha256,event.payloadSha256,grant.expiresAt]);
}

test('0047 schema is repeatable and tool proposals cannot self-activate',async()=>{
 const f=await fixture();
 try{
  await f.db.exec(await readFile(new URL('../cloud/hatchable/migrations/0047_omni_state_machine.sql',import.meta.url),'utf8'));
  const tables=(await f.db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'brain_omni_%'")).rows.map(x=>x.table_name);
  for(const name of ['brain_omni_shadow_events','brain_omni_advisory_signatures','brain_omni_candidate_tools','brain_omni_transition_events'])assert.ok(tables.includes(name),name);
  await f.db.query("INSERT INTO brain_omni_candidate_tools(tool_name,manifest,manifest_sha256) VALUES($1,'{}',$2)",['proposed.inactive','f'.repeat(64)]);
  await assert.rejects(f.db.query("UPDATE brain_omni_candidate_tools SET is_active=true WHERE tool_name='proposed.inactive'"),/check constraint|denied|immutable|append-only/);
  await assert.rejects(f.db.query("DELETE FROM brain_omni_candidate_tools"),/immutable|denied|append-only/);
 }finally{await f.close()}
});

test('same canonical nonce is idempotent but mismatched payload and scope fail',async()=>{
 const f=await fixture();
 try{
  const first=await f.machine.ingestEvent({payload,nonce:'nonce-shadownote-0001',sourceSha:SHA});
  const duplicate=await f.machine.ingestEvent({payload:{meta:{scope:'sandbox',attempt:1},objective:payload.objective,kind:payload.kind},nonce:first.nonce,sourceSha:SHA});
  assert.equal(first.id,duplicate.id);assert.equal(first.payloadSha256,hash(payload));
  await assert.rejects(f.machine.ingestEvent({payload:{...payload,objective:'different'},nonce:first.nonce,sourceSha:SHA}),/nonce-conflict/);
  await assert.rejects(f.machine.ingestEvent({payload,nonce:first.nonce,sourceSha:'b'.repeat(40)}),/nonce-conflict/);
  await assert.rejects(f.machine.ingestEvent({payload,nonce:'nonce-paid-0002',sourceSha:SHA,maxPaidCents:1}),/admission-denied/);
  await assert.rejects(f.machine.ingestEvent({payload,nonce:'nonce-write-0003',sourceSha:SHA,effect:'write'}),/admission-denied/);
  assert.equal((await f.db.query("SELECT current_state FROM brain_omni_shadow_events WHERE id=$1",[first.id])).rows[0].current_state,'RECEIVED');
 }finally{await f.close()}
});

test('direct SQL skipping states, identity mutation and deletion are blocked',async()=>{
 const f=await fixture();
 try{
  const event=await f.machine.ingestEvent({payload,nonce:'nonce-shadowdeny-0001',sourceSha:SHA});
  await assert.rejects(f.db.query("UPDATE brain_omni_shadow_events SET current_state='AUTHORIZED' WHERE id=$1",[event.id]),/transition|constraint|grant/);
  await assert.rejects(f.db.query("UPDATE brain_omni_shadow_events SET payload='{}' WHERE id=$1",[event.id]),/immutable|denied/);
  await assert.rejects(f.db.query("DELETE FROM brain_omni_shadow_events WHERE id=$1",[event.id]),/immutable|denied/);
  assert.equal((await f.machine.persistEvent(event.id)).currentState,'PERSISTED');
  await assert.rejects(f.machine.persistEvent(event.id),/invalid-transition/);
  await assert.rejects(f.db.query("UPDATE brain_omni_shadow_events SET current_state='EXECUTED_AND_VERIFIED' WHERE id=$1",[event.id]),/transition|constraint|receipt/);
 }finally{await f.close()}
});

test('seven self-asserted signatures cannot substitute for owner approval',async()=>{
 const f=await fixture();
 try{
  const event=await f.machine.ingestEvent({payload,nonce:'nonce-shadowsign-0001',sourceSha:SHA});
  await f.machine.persistEvent(event.id);
  for(let n=0;n<7;n++)await f.db.query("INSERT INTO brain_omni_advisory_signatures(event_id,signer_fingerprint,signature) VALUES($1,$2,$3)",[event.id,String(n).padStart(64,'a'),'unverified-advisory-signature']);
  await assert.rejects(f.machine.authorizeEvent(event.id,{grant:{}}),/authorization-denied/);
  assert.equal((await f.db.query("SELECT current_state FROM brain_omni_shadow_events WHERE id=$1",[event.id])).rows[0].current_state,'PERSISTED');
 }finally{await f.close()}
});

test('owner P-256 grant signature binds exact nonce, payload, grant and expiry',async()=>{
 const f=await fixture();
 try{
  const event=await f.machine.ingestEvent({payload,nonce:'nonce-shadowgrant-0001',sourceSha:SHA});
  await f.machine.persistEvent(event.id);
  const grant=signGrant(f,event);
  await grantRow(f,event,grant);
  await assert.rejects(f.machine.authorizeEvent(event.id,{grant:{...grant,payloadSha256:'b'.repeat(64)}}),/authorization-denied/);
  await assert.rejects(f.machine.authorizeEvent(event.id,{grant:signGrant(f,event,{expiresAt:new Date(Date.now()-1000).toISOString()})}),/authorization-denied/);
  const ok=await f.machine.authorizeEvent(event.id,{grant});assert.equal(ok.currentState,'AUTHORIZED');
  await assert.rejects(f.machine.authorizeEvent(event.id,{grant}),/invalid-transition/);
 }finally{await f.close()}
});

test('verified completion requires independently injected provider readback and exact nonce',async()=>{
 const f=await fixture();
 try{
  const event=await f.machine.ingestEvent({payload,nonce:'nonce-shadowverify-0001',sourceSha:SHA});
  await f.machine.persistEvent(event.id);
  const grant=signGrant(f,event);
  await grantRow(f,event,grant);await f.machine.authorizeEvent(event.id,{grant});
  await assert.rejects(f.machine.completeExecution(event.id,{receipt:{ok:true}}),/readback-required/);
  await assert.rejects(f.machine.completeExecution(event.id,{receipt:{ok:true},verifyReadback:async()=>false}),/readback-rejected/);
  assert.equal((await f.db.query("SELECT current_state FROM brain_omni_shadow_events WHERE id=$1",[event.id])).rows[0].current_state,'AUTHORIZED');
  await f.machine.markReconcileRequired(event.id,'provider write status unknown');
  const receipt={nonce:event.nonce,payloadSha256:event.payloadSha256,provider:'fixture',effectId:'provider-read-001'};
  const ok=await f.machine.completeExecution(event.id,{receipt,verifyReadback:async({event:row,receipt:proof})=>
   row.id===event.id&&proof.nonce===event.nonce&&proof.payloadSha256===event.payloadSha256&&proof.effectId==='provider-read-001'});
  assert.equal(ok.currentState,'EXECUTED_AND_VERIFIED');
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM brain_omni_transition_events WHERE event_id=$1",[event.id])).rows[0].n,4);
  await assert.rejects(f.machine.completeExecution(event.id,{receipt,verifyReadback:async()=>true}),/invalid-transition/);
  await assert.rejects(f.db.query("UPDATE brain_omni_transition_events SET from_state=NULL WHERE event_id=$1",[event.id]),/append-only/);
 }finally{await f.close()}
});

test('mutable getters are snapshotted once before hashing and persistence',async()=>{
 const f=await fixture();
 try{
  let reads=0;
  const changing={kind:'research.plan',meta:{scope:'sandbox'},
   get objective(){reads++;return reads===1?'accepted-first':'unexpected-later';}};
  const event=await f.machine.ingestEvent({payload:changing,nonce:'nonce-shadowgetter-0001',sourceSha:SHA});
  assert.equal(reads,1,'caller getter must not be re-read between admission and INSERT');
  assert.equal(event.payload.objective,'accepted-first');
  assert.equal(event.payloadSha256,hash({kind:'research.plan',meta:{scope:'sandbox'},objective:'accepted-first'}));
  await assert.rejects(f.db.query("INSERT INTO brain_omni_shadow_events(nonce,payload,payload_sha256,repository,source_sha,current_state,grant_id,owner_proof_sha) VALUES($1,'{}',$2,$3,$4,'AUTHORIZED','fake-grant',$2)",
   ['nonce-forge-direct-0002','f'.repeat(64),REPO,SHA]),/insert-must-be-received|foreign key/);
 }finally{await f.close()}
});

test('grant getter cannot substitute another valid database grant after signature check',async()=>{
 const f=await fixture();
 try{
  const event=await f.machine.ingestEvent({payload,nonce:'nonce-grant-getter-0001',sourceSha:SHA});
  await f.machine.persistEvent(event.id);
  const original=signGrant(f,event);
  await grantRow(f,event,original);
  const other={...original,grantId:'omni-shadow-mutable-target-0002'};
  await grantRow(f,event,other);
  let reads=0;
  const moving={...original};
  Object.defineProperty(moving,'grantId',{enumerable:true,get(){
   reads++;
   return reads<=3?original.grantId:other.grantId;
  }});
  const auth=await f.machine.authorizeEvent(event.id,{grant:moving});
  assert.equal(auth.grantId,original.grantId,'must persist only the ID cryptographically signed');
  assert.equal(reads,1,'owner grant must be snapshotted once');
 }finally{await f.close()}
});
test('receipt getter cannot alter durable evidence after independent readback',async()=>{
 const f=await fixture();
 try{
  const event=await f.machine.ingestEvent({payload,nonce:'nonce-receipt-getter-0001',sourceSha:SHA});
  await f.machine.persistEvent(event.id);
  const grant=signGrant(f,event);await grantRow(f,event,grant);
  await f.machine.authorizeEvent(event.id,{grant});
  let reads=0;
  const receipt={payloadSha256:event.payloadSha256,provider:'fixture',effectId:'independent-read-001',
   get nonce(){reads++;return reads<=2?event.nonce:'spoofed-nonce-after-verification';}};
  const result=await f.machine.completeExecution(event.id,{
   receipt,verifyReadback:async({receipt:provided})=>provided.nonce===event.nonce});
  assert.equal(result.providerReceipt.nonce,event.nonce);
  assert.equal(reads,1,'provider receipt must be snapshotted once');
 }finally{await f.close()}
});
