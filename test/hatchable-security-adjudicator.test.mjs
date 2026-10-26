import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyDelegatedGrant,consumeDelegatedGrant} from '../cloud/hatchable/lib/security-adjudicator.js';

const subtle=webcrypto.subtle;
const base={
 schema:'ultron.security-grant.v1',
 grantId:'owner-approved-20261025-001',
 issuer:'ultron-independent-security',
 audience:'ultron-cloud-brain',
 actor:'worker:destiny',
 objectiveId:'issue-95-reconcile',
 operation:'repo.issue.create',
 resource:'michaeljwilliams0123/mahoraga',
 policySha:'a'.repeat(64),
 notBefore:'2026-10-25T10:00:00.000Z',
 expiresAt:'2026-10-25T10:10:00.000Z',
 administrativeChange:false
};
const request={
 actor:base.actor,objectiveId:base.objectiveId,
 operation:base.operation,resource:base.resource,administrativeChange:false
};
let keys;
async function keyPair(){return keys??=await subtle.generateKey(
 {name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);}
async function signed(grant=base){
 const pair=await keyPair(),payload=JSON.stringify(grant);
 const signature=await subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,
  new TextEncoder().encode(payload));
 return {payload,signature:Buffer.from(signature).toString('base64url')};
}
async function check(grant=base,otherRequest=request,now='2026-10-25T10:05:00.000Z'){
 const pair=await keyPair();
 return verifyDelegatedGrant({envelope:await signed(grant),
  publicJwk:await subtle.exportKey('jwk',pair.publicKey),
  request:otherRequest,now,subtle});
}
test('independent signed capability authorizes one exact worker/objective/operation/resource',async()=>{
 const result=await check();
 assert.deepEqual(result,{
  authorized:true,grantId:base.grantId,actor:base.actor,
  objectiveId:base.objectiveId,operation:base.operation,resource:base.resource,
  policySha:base.policySha,expiresAt:base.expiresAt,administrativeChange:false
 });
 assert.equal('privateKey' in result,false);
});
test('editing signed grant details after issuance fails cryptographic verification',async()=>{
 const pair=await keyPair(),envelope=await signed();
 envelope.payload=JSON.stringify({...base,resource:'michaeljwilliams0123/Ultron.MW'});
 await assert.rejects(verifyDelegatedGrant({envelope,
  publicJwk:await subtle.exportKey('jwk',pair.publicKey),
  request:{...request,resource:'michaeljwilliams0123/Ultron.MW'},
  now:'2026-10-25T10:05:00.000Z',subtle}),/invalid-grant-signature/);
});
test('expired or not-yet-active grants never authorize execution',async()=>{
 await assert.rejects(check(base,request,'2026-10-25T10:10:00.001Z'),/grant-expired/);
 await assert.rejects(check(base,request,'2026-10-25T09:59:59.999Z'),/grant-not-yet-valid/);
});
test('worker identity, objective and resource must match every signed claim',async()=>{
 for(const mismatch of [
  {...request,actor:'worker:mike'},
  {...request,objectiveId:'other-objective'},
  {...request,resource:'michaeljwilliams0123/Ultron.MW'},
  {...request,operation:'repo.verify.dispatch'}
 ]){
  await assert.rejects(check(base,mismatch),/grant-scope-mismatch/);
 }
});
test('privilege changes require independently signed administrative-change authority',async()=>{
 await assert.rejects(check(base,{...request,operation:'permissions.change',
  administrativeChange:true}),/grant-scope-mismatch/);
 const admin={...base,operation:'permissions.change',administrativeChange:true,
  grantId:'owner-approved-20261025-002'};
 const result=await check(admin,{...request,operation:'permissions.change',
  administrativeChange:true});
 assert.equal(result.authorized,true);
 assert.equal(result.administrativeChange,true);
});
test('long-lived grants and forbidden credential exfiltration operations fail closed',async()=>{
 await assert.rejects(check({...base,expiresAt:'2026-10-25T11:00:00.000Z'}),/grant-ttl-exceeded/);
 const forbidden={...base,operation:'credentials.export'};
 await assert.rejects(check(forbidden,{...request,operation:'credentials.export'}),/unsupported-grant-operation/);
});
test('one-time consumption writes an event atomically and rejects replay',async()=>{
 const calls=[];
 const db={query:async(sql,params)=>{
  calls.push({sql,params});
  return {rows:calls.length===1?[{grant_id:base.grantId,receipt_id:101}]:[]};
 }};
 const verified=await check();
 const first=await consumeDelegatedGrant({db,verifiedGrant:verified});
 assert.deepEqual(first,{ok:true,grantId:base.grantId,receiptId:101});
 assert.match(calls[0].sql,/ON CONFLICT\s*\(grant_id\)\s*DO NOTHING/);
 assert.match(calls[0].sql,/INSERT INTO brain_events/);
 const replay=await consumeDelegatedGrant({db,verifiedGrant:verified});
 assert.deepEqual(replay,{ok:false,error:'grant-replayed'});
});
test('unverified plain objects cannot be consumed as execution authority',async()=>{
 let writes=0;
 const db={query:async()=>{writes++;return {rows:[]};}};
 await assert.rejects(consumeDelegatedGrant({db,verifiedGrant:{
  ...base,authorized:true}}),/invalid-verified-grant/);
 assert.equal(writes,0);
});
