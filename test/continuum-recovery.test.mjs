import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileContinuumTick, measureObservedSchedulerSlo} from '../src/continuum-recovery.mjs';

const NOW='2026-11-01T12:00:00.000Z';
const SHA='a'.repeat(40);
const delivery='continuum:delivery-0001';
const row=(extra={})=>({
  deliveryId:delivery, repository:'michaeljwilliams0123/Ultron.MW', sourceSha:SHA, leaseGeneration:7,
  state:'pending', effect:'advisory', maxPaidCents:0,
  expiresAt:'2026-11-01T11:59:00.000Z', ...extra
});
const control=(extra={})=>({paused:false,maxPaidCents:0,paidFallback:false,...extra});

test('C02 pause prevents due-list reads, external dispatch and database transitions',async()=>{
  let reads=0,writes=0;
  const result=await reconcileContinuumTick({
    now:NOW,readControl:async()=>control({paused:true}),
    listDue:async()=>{reads++;return [delivery];},
    outbox:{observe:async()=>{reads++;return row();},markUnknown:async()=>{writes++;}}
  });
  assert.equal(result.status,'paused');
  assert.equal(reads,0);assert.equal(writes,0);
  assert.equal(result.externalDispatches,0);
});

test('C02 denies paid or fallback policy before any outbox access',async()=>{
  for(const bad of [control({maxPaidCents:1}),control({paidFallback:true})]){
    let touched=false;
    const result=await reconcileContinuumTick({
      now:NOW,readControl:async()=>bad,
      listDue:async()=>{touched=true;return [];},
      outbox:{observe:async()=>{touched=true;}}
    });
    assert.equal(result.status,'held-zero-cost');
    assert.equal(touched,false);
  }
});

test('C02 expired pending intent is fenced into reconcile-required without replaying external writes',async()=>{
  const transitions=[];
  const result=await reconcileContinuumTick({
    now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
    outbox:{
      observe:async({deliveryId})=>{assert.equal(deliveryId,delivery);return row();},
      markUnknown:async args=>{transitions.push(args);return {changed:true,state:'reconcile-required'};}
    }
  });
  assert.deepEqual(transitions,[{deliveryId:delivery,sourceSha:SHA,leaseGeneration:7}]);
  assert.equal(result.receipts[0].disposition,'reconcile-required');
  assert.equal(result.externalDispatches,0);
});

test('C02 pending unexpired and already-uncertain intents never cause another write',async()=>{
  let writes=0;
  const pending=await reconcileContinuumTick({
    now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
    outbox:{observe:async()=>row({expiresAt:'2026-11-02T12:00:00Z'}),markUnknown:async()=>{writes++;}}
  });
  const unknown=await reconcileContinuumTick({
    now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
    outbox:{observe:async()=>row({state:'reconcile-required'}),markUnknown:async()=>{writes++;}}
  });
  assert.equal(pending.receipts[0].disposition,'pending');
  assert.equal(unknown.receipts[0].disposition,'reconcile-required');
  assert.equal(writes,0);
});

test('C02 duplicate or malformed due queue is held before any transition',async()=>{
  for(const ids of [[delivery,delivery],['bad'],Array.from({length:21},(_,i)=>'continuum:delivery-'+String(i).padStart(4,'0'))]){
    let wrote=false;
    await assert.rejects(reconcileContinuumTick({
      now:NOW,readControl:async()=>control(),listDue:async()=>ids,
      outbox:{observe:async()=>row(),markUnknown:async()=>{wrote=true;}}
    }),/continuum-recovery-queue-invalid/);
    assert.equal(wrote,false);
  }
});

test('C02 rejects coercible but invalid paid-cost values before any state transition',async()=>{
  for(const badCost of [null,false,'',[],[0],{}]){
    let writes=0;
    const result=await reconcileContinuumTick({
      now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
      outbox:{observe:async()=>row({maxPaidCents:badCost}),
        markUnknown:async()=>{writes++;return {state:'reconcile-required'};}}
    });
    assert.equal(result.status,'held-partial');
    assert.equal(result.receipts[0].disposition,'held-unknown');
    assert.equal(writes,0);
  }
});

test('C02 unknown database response produces hold receipt, never blind retries',async()=>{
  let calls=0;
  const result=await reconcileContinuumTick({
    now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
    outbox:{observe:async()=>row(),markUnknown:async()=>{calls++;throw Error('lost-response');}}
  });
  assert.equal(calls,1);
  assert.equal(result.receipts[0].disposition,'held-unknown');
  assert.equal(result.externalDispatches,0);
});

test('C02 measured seven-day SLO counts missing slots as failures and ignores duplicates',()=>{
  const start='2026-10-25T12:00:00Z',end='2026-11-01T12:00:00Z';
  const result=measureObservedSchedulerSlo({
    startAt:start,endAt:end,intervalMinutes:60,
    runs:[
      {scheduledAt:start,success:true,source:'scheduler'},
      {scheduledAt:start,success:true,source:'scheduler'},
      {scheduledAt:'2026-10-25T13:00:00Z',success:false,source:'scheduler'}
    ]
  });
  assert.equal(result.expectedSlots,168);
  assert.equal(result.observedSlots,2);
  assert.equal(result.successfulSlots,1);
  assert.equal(result.meetsTarget,false);
  assert.equal(result.evidenceComplete,false);
});

test('C02 short observation window cannot certify seven-day SLO',()=>{
  const result=measureObservedSchedulerSlo({
    startAt:'2026-10-31T12:00:00Z',endAt:'2026-11-01T12:00:00Z',
    intervalMinutes:60,runs:[{scheduledAt:'2026-10-31T12:00:00Z',success:true,source:'scheduler'}]
  });
  assert.equal(result.meetsTarget,false);
  assert.equal(result.evidenceComplete,false);
});


test('C02 full seven-day 168-slot observed success meets target with genuine scheduler receipts',()=>{
 const start=Date.parse('2026-10-25T12:00:00Z');
 const end=new Date(start+168*60*60*1000).toISOString();
 const runs=Array.from({length:168},(_,i)=>({
  scheduledAt:new Date(start+i*60*60*1000).toISOString(),
  success:true,source:'scheduler'
 }));
 const result=measureObservedSchedulerSlo({
  startAt:new Date(start).toISOString(),endAt:end,intervalMinutes:60,runs
 });
 assert.equal(result.expectedSlots,168);
 assert.equal(result.observedSlots,168);
 assert.equal(result.successfulSlots,168);
 assert.equal(result.missingSlots,0);
 assert.equal(result.successRate,1);
 assert.equal(result.evidenceComplete,true);
 assert.equal(result.meetsTarget,true);
});

test('C02 complete seven-day coverage with one failed, forged or duplicated bad receipt fails the 99.5% target',()=>{
 const start=Date.parse('2026-10-25T12:00:00Z');
 const all=Array.from({length:168},(_,i)=>({
  scheduledAt:new Date(start+i*60*60*1000).toISOString(),
  success:true,source:'scheduler'
 }));
 const opts={startAt:new Date(start).toISOString(),
  endAt:new Date(start+168*60*60*1000).toISOString(),intervalMinutes:60};
 for(const runs of [
  all.map((x,i)=>i===100?{...x,success:false}:x),
  all.map((x,i)=>i===100?{...x,source:'manual'}:x),
  [...all,{...all[100],success:false}]
 ]){
  const result=measureObservedSchedulerSlo({...opts,runs});
  assert.equal(result.expectedSlots,168);
  assert.equal(result.observedSlots,168);
  assert.equal(result.evidenceComplete,true);
  assert.equal(result.successfulSlots,167);
  assert.equal(result.meetsTarget,false);
 }
});

test('C02 nearly full seven-day success cannot meet target when one scheduler slot is missing',()=>{
 const start=Date.parse('2026-10-25T12:00:00Z');
 const runs=Array.from({length:167},(_,i)=>({
  scheduledAt:new Date(start+i*60*60*1000).toISOString(),
  success:true,source:'scheduler'
 }));
 const result=measureObservedSchedulerSlo({startAt:new Date(start).toISOString(),
  endAt:new Date(start+168*60*60*1000).toISOString(),runs});
 assert.equal(result.expectedSlots,168);
 assert.equal(result.missingSlots,1);
 assert.equal(result.evidenceComplete,false);
 assert.equal(result.meetsTarget,false);
});
