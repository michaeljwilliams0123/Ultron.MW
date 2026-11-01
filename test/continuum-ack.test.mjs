import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyContinuumAck,recordContinuumAck} from '../src/continuum-ack.mjs';

const secret='distinct-external-worker-held-32-byte-test-key';
const now=Date.parse('2026-11-01T16:30:00.000Z');
const body=()=>({
  schema:'ultron.continuum-ack.v1',source:'mahoraga-cloud',
  receiptId:'continuum-ack-0000001',deliveryId:'continuum-delivery-0001',
  taskId:71,sourceSha:'a'.repeat(40),requestSha:'b'.repeat(64),
  authoritySha:'c'.repeat(64),routeSha:'d'.repeat(64),
  leaseGeneration:2,status:'acknowledged',maxPaidCents:0
});
async function signed(item=body(),key=secret,time=now){
  const timestamp=String(Math.floor(time/1000)),raw=JSON.stringify(item);
  const k=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(key),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await webcrypto.subtle.sign('HMAC',k,new TextEncoder().encode(timestamp+'.'+raw));
  return {raw,timestamp,signature:'sha256='+Buffer.from(bytes).toString('hex')};
}
function mockDb(){
  const entries=new Map(),calls=[];
  return {entries,calls,async query(sql,params=[]){
    calls.push({sql,params});
    if(sql.includes('INSERT INTO brain_continuum_receipts')){
      const [receiptId,deliveryId,source,payloadSha,taskId,sourceSha,requestSha,
        authoritySha,routeSha,leaseGeneration,maxPaidCents]=params;
      if(taskId!==71||sourceSha!=='a'.repeat(40)||requestSha!=='b'.repeat(64)||
        authoritySha!=='c'.repeat(64)||leaseGeneration!==2||maxPaidCents!==0)return {rows:[]};
      if(entries.has(deliveryId))return {rows:[]};
      entries.set(deliveryId,{receiptId,deliveryId,source,payloadSha,routeSha});
      return {rows:[{receiptId,deliveryId}]};
    }
    if(sql.includes('FROM brain_continuum_receipts')){
      const row=entries.get(params[0]);return {rows:row?[{...row}]:[]};
    }
    throw Error('unexpected SQL');
  }};
}
test('RED: independently keyed HMAC confirms exact raw ACK bytes and immutable route',async()=>{
  const wire=await signed();
  const verified=await verifyContinuumAck({...wire,secret,expectedSource:'mahoraga-cloud',now,subtle:webcrypto.subtle});
  assert.equal(verified.deliveryId,body().deliveryId);
  assert.equal(verified.routeSha,body().routeSha);
  assert.equal(verified.status,'acknowledged');
  assert.match(verified.payloadSha,/^[a-f0-9]{64}$/);
  assert.equal('secret' in verified,false);
  await assert.rejects(verifyContinuumAck({...wire,raw:JSON.stringify({...body(),taskId:72}),
    secret,expectedSource:'mahoraga-cloud',now,subtle:webcrypto.subtle}),/continuum-ack-signature-invalid/);
});
test('C03 bridge source is bound to the expected separately keyed receiver',async()=>{
 const wire=await signed();
 await assert.rejects(verifyContinuumAck({...wire,secret,
  expectedSource:'destiny-work',now,subtle:webcrypto.subtle}),
  /continuum-ack-source-mismatch/);
 await assert.rejects(verifyContinuumAck({...wire,secret,
  now,subtle:webcrypto.subtle}),/continuum-ack-authentication-unconfigured/);
});

test('RED: forged ACK objects, stale signatures and changed route are rejected before SQL',async()=>{
  const db=mockDb(),wire=await signed();
  await assert.rejects(recordContinuumAck({db,ack:{...body(),verified:true}}),
    /continuum-ack-unverified/);
  await assert.rejects(verifyContinuumAck({...wire,secret,expectedSource:'mahoraga-cloud',now:now+301000,subtle:webcrypto.subtle}),
    /continuum-ack-timestamp-expired/);
  for(const patch of [{source:'owner'}, {status:'verified'}, {maxPaidCents:1},
    {routeSha:'short'}, {leaseGeneration:0}]){
    const envelope=await signed({...body(),...patch});
    await assert.rejects(verifyContinuumAck({...envelope,secret,expectedSource:'mahoraga-cloud',now,subtle:webcrypto.subtle}),
      /continuum-ack-invalid/);
  }
  assert.equal(db.calls.length,0);
});
test('RED: a verified bridge ACK persists one scoped immutable receipt without claiming Work completion',async()=>{
  const db=mockDb(),wire=await signed();
  const ack=await verifyContinuumAck({...wire,secret,expectedSource:'mahoraga-cloud',now,subtle:webcrypto.subtle});
  assert.deepEqual(await recordContinuumAck({db,ack}),{
    accepted:true,created:true,receiptId:body().receiptId,verification:'bridge-authenticated-only'
  });
  assert.deepEqual(await recordContinuumAck({db,ack}),{
    accepted:true,created:false,receiptId:body().receiptId,verification:'bridge-authenticated-only'
  });
  assert.equal(db.entries.size,1);
  assert.equal(db.calls.filter(c=>c.sql.includes('INSERT INTO brain_continuum_receipts')).length,2);
  assert.match(db.calls[0].sql,/FROM brain_continuum_outbox/);
  assert.match(db.calls[0].sql,/ON CONFLICT DO NOTHING/);
});
test('RED: mismatched signed identities cannot reconcile to a foreign ACK',async()=>{
  const db=mockDb();
  const first=await signed();
  await recordContinuumAck({db,ack:await verifyContinuumAck({...first,secret,expectedSource:'mahoraga-cloud',now,subtle:webcrypto.subtle})});
  const changed=await signed({...body(),receiptId:'continuum-ack-foreign',routeSha:'e'.repeat(64)});
  const ack=await verifyContinuumAck({...changed,secret,expectedSource:'mahoraga-cloud',now,subtle:webcrypto.subtle});
  await assert.rejects(recordContinuumAck({db,ack}),/continuum-ack-conflict/);
  assert.equal(db.entries.size,1);
});
