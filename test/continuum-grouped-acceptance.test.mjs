import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createContinuumOutbox} from '../src/continuum-outbox.mjs';
import {reconcileContinuumTick} from '../src/continuum-recovery.mjs';
import {verifyContinuumAck,recordContinuumAck} from '../src/continuum-ack.mjs';
import {assessContinuumEvidence} from '../src/continuum-evidence.mjs';

const sourceSha='a'.repeat(40),requestSha='b'.repeat(64);
const authoritySha='c'.repeat(64),routeSha='d'.repeat(64);
const deliveryId='continuum-delivery-0001';
const secret='test-only-separate-receiver-signing-secret';
const start='2026-11-03T20:00:00.000Z',tick='2026-11-03T20:02:00.000Z';
const contract=()=>({taskId:71,objectiveId:'continuum-objective-0001',deliveryId,
  idempotencyKey:'continuum:delivery:0001',repository:'michaeljwilliams0123/Ultron.MW',
  sourceSha,authoritySha,requestSha,leaseGeneration:2,
  expiresAt:'2026-11-03T20:01:00.000Z',effect:'read',maxPaidCents:0});
const control=()=>({paused:false,revoked:false,maxPaidCents:0,paidFallback:false});

// One in-memory SQL boundary models the immutable outbox, separately
// registered route and receipt. It makes the cross-module contract executable;
// it is not a PostgreSQL or external-provider observation.
function database({loseInsertAck=false}={}){
  const intents=new Map(),receipts=new Map(),routes=new Map(),calls=[];
  let lose=loseInsertAck;
  return {intents,receipts,routes,calls,async query(sql,params=[]){
    calls.push(sql);
    if(sql.includes('INSERT INTO brain_continuum_outbox')){
      const keys=['taskId','objectiveId','deliveryId','idempotencyKey','repository',
        'sourceSha','authoritySha','requestSha','leaseGeneration','expiresAt',
        'effect','maxPaidCents'];
      const row=Object.fromEntries(keys.map((key,i)=>[key,params[i]]));
      if(intents.has(row.deliveryId))return {rows:[]};
      intents.set(row.deliveryId,{...row,state:'pending'});
      if(lose){lose=false;throw Error('simulated committed write with lost ACK');}
      return {rows:[{deliveryId:row.deliveryId,state:'pending'}]};
    }
    if(sql.includes('UPDATE brain_continuum_outbox')){
      const row=intents.get(params[0]);
      if(!row||row.sourceSha!==params[1]||row.leaseGeneration!==params[2]||
        row.state!=='pending')return {rows:[]};
      row.state='reconcile-required';
      return {rows:[{deliveryId:row.deliveryId,state:row.state}]};
    }
    if(sql.trimStart().startsWith('SELECT')&&sql.includes('FROM brain_continuum_outbox')){
      const row=intents.get(params[0]);return {rows:row?[{...row}]:[]};
    }
    if(sql.includes('INSERT INTO brain_continuum_receipts')){
      const [receiptId,id,source,payloadSha,taskId,head,request,authority,route,lease,cost]=params;
      const row=intents.get(id),registered=routes.get(id);
      if(!row||registered?.source!==source||registered.routeSha!==route||
        row.taskId!==taskId||row.sourceSha!==head||row.requestSha!==request||
        row.authoritySha!==authority||row.leaseGeneration!==lease||
        row.maxPaidCents!==cost||!['pending','reconcile-required'].includes(row.state)||
        receipts.has(id))return {rows:[]};
      receipts.set(id,{receiptId,deliveryId:id,source,payloadSha,routeSha:route});
      return {rows:[{receiptId,deliveryId:id}]};
    }
    if(sql.includes('FROM brain_continuum_receipts')){
      const row=receipts.get(params[0]);return {rows:row?[{...row}]:[]};
    }
    throw Error('unexpected SQL');
  }};
}
async function signedAck(patch={}){
  const raw=JSON.stringify({schema:'ultron.continuum-ack.v1',source:'mahoraga-cloud',
    receiptId:'continuum-ack-0000001',deliveryId,taskId:71,sourceSha,
    requestSha,authoritySha,routeSha,leaseGeneration:2,status:'acknowledged',
    maxPaidCents:0,...patch});
  const timestamp=String(Date.parse(tick)/1000);
  const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature='sha256='+Buffer.from(await webcrypto.subtle.sign('HMAC',key,
    new TextEncoder().encode(timestamp+'.'+raw))).toString('hex');
  return {raw,timestamp,signature,secret,expectedSource:'mahoraga-cloud',
    now:Date.parse(tick),subtle:webcrypto.subtle};
}
const tickOnce=(outbox,db,readControl=async()=>control())=>reconcileContinuumTick({
  outbox,readControl,now:tick,
  listDue:async()=>[...db.intents.keys()]
});

test('OR-02/03/08 + C03: lost database ACK, missed tick and signed receipt converge once',async()=>{
  const db=database({loseInsertAck:true}),outbox=createContinuumOutbox({db,now:()=>start});
  assert.deepEqual(await outbox.reserve(contract()),{
    created:false,deliveryId,state:'pending',reconciled:true});
  assert.equal((await outbox.reserve(contract())).created,false);
  db.routes.set(deliveryId,{source:'mahoraga-cloud',routeSha});
  const first=await tickOnce(outbox,db);
  const second=await tickOnce(outbox,db);
  assert.equal(first.receipts[0].disposition,'reconcile-required');
  assert.equal(second.receipts[0].disposition,'reconcile-required');
  const ack=await verifyContinuumAck(await signedAck());
  assert.equal((await recordContinuumAck({db,ack})).created,true);
  assert.equal((await recordContinuumAck({db,ack})).created,false);
  assert.equal(db.intents.size,1);
  assert.equal(db.receipts.size,1);
  assert.equal(db.calls.filter(sql=>sql.includes('UPDATE brain_continuum_outbox')).length,1);
  assert.equal(first.externalDispatches+second.externalDispatches,0);
});

test('OR-05/06/07 + C03: stale fence, changed delivery and paid cost cannot create a receipt',async()=>{
  const db=database(),outbox=createContinuumOutbox({db,now:()=>start});
  await outbox.reserve(contract());
  db.routes.set(deliveryId,{source:'mahoraga-cloud',routeSha});
  await assert.rejects(outbox.reserve({...contract(),requestSha:'e'.repeat(64)}),/delivery-conflict/);
  await assert.rejects(outbox.reserve({...contract(),maxPaidCents:1}),/admission-denied/);
  await assert.rejects(outbox.markUnknown({deliveryId,sourceSha,leaseGeneration:1}),/fence-or-source-conflict/);
  for(const patch of [{leaseGeneration:1},{requestSha:'e'.repeat(64)},{maxPaidCents:1}]){
    const wire=await signedAck(patch);
    if(patch.maxPaidCents){
      await assert.rejects(verifyContinuumAck(wire),/continuum-ack-invalid/);
    }else{
      const ack=await verifyContinuumAck(wire);
      await assert.rejects(recordContinuumAck({db,ack}),/continuum-ack-write-uncertain/);
    }
  }
  assert.equal(db.receipts.size,0);
  assert.equal(db.intents.get(deliveryId).state,'pending');
});

test('C02/C03: revocation or wrong receiver route holds without inventing completion',async()=>{
  const db=database(),outbox=createContinuumOutbox({db,now:()=>start});
  await outbox.reserve(contract());
  assert.equal((await tickOnce(outbox,db,async()=>({...control(),revoked:true}))).status,'held-revoked');
  assert.equal(db.intents.get(deliveryId).state,'pending');
  db.routes.set(deliveryId,{source:'destiny-work',routeSha});
  const ack=await verifyContinuumAck(await signedAck());
  await assert.rejects(recordContinuumAck({db,ack}),/continuum-ack-write-uncertain/);
  assert.equal(db.receipts.size,0);
});

test('EV assessor: simulated bridge ACK and claimed metadata never certify a live release',async()=>{
  const db=database(),outbox=createContinuumOutbox({db,now:()=>start});
  await outbox.reserve(contract());
  db.routes.set(deliveryId,{source:'mahoraga-cloud',routeSha});
  const ack=await verifyContinuumAck(await signedAck());
  await recordContinuumAck({db,ack});
  const stored=db.receipts.get(deliveryId);
  assert.equal(stored.receiptId,ack.receiptId);
  assert.equal(stored.deliveryId,ack.deliveryId);
  assert.equal(stored.routeSha,ack.routeSha);
  const evidence={schema:'ultron.continuum-evidence.v1',objectiveId:contract().objectiveId,
    taskId:`task-${String(ack.taskId).padStart(4,'0')}`,deliveryId:stored.deliveryId,
    actorId:'test-actor-01',runtimeId:'test-runtime-01',
    baseSha:ack.sourceSha,headSha:ack.sourceSha,deployedSha:null,
    capability:'continuum.c03',policyVersion:'v1',
    authorization:{grantId:'test-grant-01',expiresAt:'2026-11-03T21:00:00.000Z',
      resource:'repo-ultron',fence:2},idempotencyKey:contract().idempotencyKey,
    attempt:1,intent:{effect:'write',preconditionSha:requestSha,estimatedPaidCents:0},
    outcome:'acknowledged',readback:{observerId:'test-observer-01',deliveryId,
      headSha:sourceSha,fence:2,observedEffect:'present',
      evidenceUrl:'https://github.com/michaeljwilliams0123/Ultron.MW/issues/185'},
    review:{reviewerId:'test-reviewer-01',headSha:sourceSha,decision:'approved',
      evidenceUrl:'https://github.com/michaeljwilliams0123/Ultron.MW/issues/204'},
    elapsedMs:10,observedPaidCents:0,artifacts:[]};
  const result=assessContinuumEvidence(evidence,{expectedHeadSha:sourceSha,now:tick});
  assert.equal(result.disposition,'observed-not-accepted');
  assert.equal(result.productionAccepted,false);
});
