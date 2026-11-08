import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyDelegatedGrant,consumeDelegatedGrant} from '../cloud/hatchable/lib/security-adjudicator.js';

const subtle=webcrypto.subtle;
const base={
 schema:'ultron.security-grant.v1',
 grantId:'owner-approved-20261025-001',
 issuer:'ultron-owner-authority',authorizedBy:'michaeljwilliams0123',
 audience:'ultron-cloud-brain',
 actor:'worker:destiny',
 objectiveId:'issue-95-reconcile',
 operation:'repo.issue.create',
 resource:'michaeljwilliams0123/mahoraga',
 policySha:'a'.repeat(64),
 notBefore:'2026-10-25T10:00:00.000Z',
 expiresAt:'2026-10-25T10:10:00.000Z',
 administrativeChange:false,
 profileVersion:5,stopVersion:3
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
test('owner-signed capability authorizes one exact worker/objective/operation/resource',async()=>{
 const result=await check();
 assert.deepEqual(result,{
  authorized:true,authorizedBy:'michaeljwilliams0123',grantId:base.grantId,actor:base.actor,
  objectiveId:base.objectiveId,operation:base.operation,resource:base.resource,
  policySha:base.policySha,profileVersion:5,stopVersion:3,
  expiresAt:base.expiresAt,administrativeChange:false
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
test('privilege changes require owner-signed administrative-change authority',async()=>{
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
 const at=new Date();
 const live={...base,notBefore:new Date(at.getTime()-60_000).toISOString(),
  expiresAt:new Date(at.getTime()+10*60_000).toISOString()};
 const verified=await check(live,request,at.toISOString());
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

test('impossible calendar dates are rejected before SQL timestamp casting',async()=>{
 await assert.rejects(check({...base,expiresAt:'2026-02-30T10:10:00.000Z'}),
  /invalid-grant-time/);
});
test('database admission itself rejects expired grants if execution waits after verifier',async()=>{
 const at=new Date(),live={...base,notBefore:new Date(at.getTime()-60_000).toISOString(),
  expiresAt:new Date(at.getTime()+10*60_000).toISOString()};
 const verified=await check(live,request,at.toISOString());
 const db={query:async(sql)=>{
  assert.match(sql,/clock_timestamp\(\)/);
  return {rows:[{grant_id:null,receipt_id:null,expired:true}]};
 }};
 const result=await consumeDelegatedGrant({db,verifiedGrant:verified});
 assert.deepEqual(result,{ok:false,error:'grant-expired'});
});

test('unversioned signatures cannot be consumed after a profile or stop change',async()=>{
 const at=new Date(),legacy={...base,
  notBefore:new Date(at.getTime()-1000).toISOString(),
  expiresAt:new Date(at.getTime()+60000).toISOString()};
 delete legacy.profileVersion;
 delete legacy.stopVersion;
 const verified=await check(legacy,request,at.toISOString());
 let writes=0;
 const result=await consumeDelegatedGrant({db:{query:async()=>{writes++;return {rows:[]};}},
  verifiedGrant:verified});
 assert.deepEqual(result,{ok:false,error:'grant-unbound'});
 assert.equal(writes,0);
});

test('signed grant consumption is fenced to the current owner profile and stop versions',async()=>{
 const at=new Date(),live={...base,
  notBefore:new Date(at.getTime()-1000).toISOString(),
  expiresAt:new Date(at.getTime()+60000).toISOString()};
 const verified=await check(live,request,at.toISOString());
 let queries=0;
 const result=await consumeDelegatedGrant({db:{query:async(sql,params)=>{
  queries++;
  assert.match(sql,/JOIN brain_runtime_control c/);
  assert.match(sql,/FOR SHARE/);
  assert.match(sql,/NOT c.paused/);
  assert.match(sql,/a.max_paid_cents=0/);
  assert.match(sql,/jsonb_exists\(a.allowed_operations,\$4::text\)/);
  assert.match(sql,/a.version=\$8/);
  assert.match(sql,/c.version=\$9/);
  assert.deepEqual(params.slice(7),[5,3]);
  return {rows:[{grant_id:null,receipt_id:null,expired:false,denied:true}]};
 }},verifiedGrant:verified});
 assert.deepEqual(result,{ok:false,error:'authority-denied'});
 assert.equal(queries,1);
});
