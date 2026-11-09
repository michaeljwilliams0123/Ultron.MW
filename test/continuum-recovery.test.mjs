import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileContinuumTick,measureObservedSchedulerSlo,
  schedulerSloObservationFromReceipt} from '../src/continuum-recovery.mjs';

const NOW='2026-11-01T12:00:00.000Z';
const SHA='a'.repeat(40);
const delivery='continuum:delivery-0001';
const row=(extra={})=>({
  deliveryId:delivery, repository:'michaeljwilliams0123/Ultron.MW', sourceSha:SHA, leaseGeneration:7,
  state:'pending', effect:'advisory', maxPaidCents:0,
  expiresAt:'2026-11-01T11:59:00.000Z', ...extra
});
const control=(extra={})=>({paused:false,revoked:false,maxPaidCents:0,paidFallback:false,...extra});

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
      markUnknown:async args=>{transitions.push(args);return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
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
        markUnknown:async()=>{writes++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}}
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

test('C02 SLO evidence adapter excludes recovery canaries and retrospective recovery receipts',()=>{
 const canonical=schedulerSloObservationFromReceipt({taskKey:'hourly-2026110914',
  eventType:'scheduled-hourly',details:{objective:'repo.inspect',trigger:'cron',
   admittedAt:'2026-11-09T14:17:03.000Z'},success:true});
 assert.deepEqual(canonical,{scheduledAt:'2026-11-09T14:00:00.000Z',
  success:true,source:'scheduler'});
 for(const receipt of [
  {taskKey:'recovery-canary-issue-184-live-01-hourly-2026110914',
   eventType:'missed-hour-recovery-canary',details:{objective:'repo.inspect'},success:true},
  {taskKey:'hourly-2026110914',eventType:'missed-hour-recovered',
   details:{objective:'repo.inspect'},success:true},
  {taskKey:'council-hourly-2026110914',eventType:'scheduled-hourly',
   details:{objective:'council.review',trigger:'cron',
    admittedAt:'2026-11-09T14:17:03.000Z'},success:true},
  {taskKey:'hourly-2026134014',eventType:'scheduled-hourly',
   details:{objective:'repo.inspect',trigger:'cron',
    admittedAt:'2026-11-09T14:17:03.000Z'},success:true},
  {taskKey:'hourly-2026110914',eventType:'scheduled-hourly',
   details:{objective:'repo.inspect'},success:true},
  {taskKey:'hourly-2026110914',eventType:'scheduled-hourly',
   details:{objective:'repo.inspect',trigger:'now',
    admittedAt:'2026-11-09T14:17:03.000Z'},success:true},
  {taskKey:'hourly-2026110914',eventType:'scheduled-hourly',
   details:{objective:'repo.inspect',trigger:'cron',
    admittedAt:'2026-11-09T15:00:00.000Z'},success:true},
  {taskKey:'hourly-2026110914',eventType:'scheduled-hourly',
   details:{objective:'repo.inspect',trigger:'cron',
    admittedAt:'2026-11-09 14:17:03Z'},success:true}
 ])assert.equal(schedulerSloObservationFromReceipt(receipt),null);
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


test('RED: C02 must reject noncanonical persisted lease generations before any reconciliation write',async()=>{
  // C01's BIGINT parser accepts only safe integers and canonical unsigned
  // decimal strings. The C02 recovery boundary must not coerce adapter data.
  const invalid=[null,false,true,'','07','7\n','0x7','7.0',[7],['7'],{},new Number(7)];
  for(const state of ['pending','reconcile-required']){
    for(const leaseGeneration of invalid){
      let writes=0,observations=0;
      const result=await reconcileContinuumTick({
        now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
        outbox:{
          observe:async()=>{observations++;return row({state,leaseGeneration});},
          markUnknown:async()=>{writes++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
        }
      });
      assert.equal(result.status,'held-partial',
        'invalid persisted fence cannot authorize any recovery state');
      assert.equal(result.receipts[0].disposition,'held-unknown');
      assert.equal(observations,1);
      assert.equal(writes,0,'no reconciliation transition for a coerced fence');
      assert.equal(result.externalDispatches,0);
    }
  }
});

test('C02 accepts a canonical BIGINT string lease on the bounded recovery path',async()=>{
  const calls=[];
  const result=await reconcileContinuumTick({
    now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
    outbox:{
      observe:async()=>row({leaseGeneration:'7'}),
      markUnknown:async args=>{calls.push(args);return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
    }
  });
  assert.deepEqual(calls,[{deliveryId:delivery,sourceSha:SHA,leaseGeneration:7}]);
  assert.equal(result.receipts[0].disposition,'reconcile-required');
});


test('RED: C02 rejects malformed or coerced persisted expiration timestamps before reconciliation',async()=>{
  // PostgreSQL returns a Date or parsable ISO/SQL timestamp; adapter arrays,
  // boxed strings, arbitrary objects and locale-only strings are not evidence.
  const valid='2026-11-01T11:59:00.000Z';
  const bad=[null,undefined,false,0,[valid],new String(valid),
    {toString:()=>valid},'11/1/2026 11:59:00',' '+valid,''];
  for(const expiresAt of bad){
    let transitions=0;
    const result=await reconcileContinuumTick({
      now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
      outbox:{
        observe:async()=>row({expiresAt}),
        markUnknown:async()=>{transitions++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
      }
    });
    assert.equal(result.status,'held-partial',
      'noncanonical expiry must not certify the intent or state transition');
    assert.equal(result.receipts[0].disposition,'held-unknown');
    assert.equal(transitions,0,'never issue SQL CAS for untrusted expiry readback');
    assert.equal(result.externalDispatches,0);
  }
});

test('C02 permits native PostgreSQL Date and an ISO timestamp for expiry',async()=>{
  for(const expiresAt of [new Date('2026-11-01T11:59:00.000Z'),
    '2026-11-01T11:59:00.000Z']){
    const result=await reconcileContinuumTick({
      now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
      outbox:{
        observe:async()=>row({expiresAt}),
        markUnknown:async()=>({changed:true,deliveryId:delivery,state:'reconcile-required'})
      }
    });
    assert.equal(result.status,'observed');
    assert.equal(result.receipts[0].disposition,'reconcile-required');
  }
});


test('RED: C02 never certifies malformed expiry on an already-uncertain intent',async()=>{
  // A reconcile-required row still needs a valid immutable readback before
  // the tick may certify a state, even though no CAS should be attempted.
  const invalid=[
    '2026-02-30T11:59:00Z',
    '2026-11-31T11:59:00Z',
    ['2026-11-01T11:59:00Z']
  ];
  for(const state of ['pending','reconcile-required']){
    for(const expiresAt of invalid){
      let writes=0;
      const result=await reconcileContinuumTick({
        now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
        outbox:{
          observe:async()=>row({state,expiresAt}),
          markUnknown:async()=>{writes++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
        }
      });
      assert.equal(result.status,'held-partial');
      assert.equal(result.receipts[0].disposition,'held-unknown');
      assert.equal(writes,0);
      assert.equal(result.externalDispatches,0);
    }
  }
});

test('RED: C02 rejects impossible scheduler calendar timestamps before readControl',async()=>{
  for(const now of ['2026-02-30T12:00:00Z','2026-11-31T12:00:00Z']){
    let read=0;
    await assert.rejects(reconcileContinuumTick({
      now,readControl:async()=>{read++;return control();},
      listDue:async()=>[delivery],
      outbox:{observe:async()=>row(),markUnknown:async()=>({changed:true,deliveryId:delivery,state:'reconcile-required'})}
    }),/continuum-recovery-time-invalid/);
    assert.equal(read,0);
  }
});


test('C02 rejects timezone-ambiguous or malformed persisted expiry without recovery transitions',async()=>{
  const invalid=[
    '2026-11-01T11:59:00','2026-11-01 11:59:00',
    '2026-11-01T11:59:00Zgarbage','2026-11-01T25:59:00Z',
    '2026-11-01T11:60:00Z','2026-11-01T11:59:00+14:30',
    '2026-11-01T11:59:00+99:00','2026-11-01T11:59Z'
  ];
  for(const state of ['pending','reconcile-required']){
    for(const expiresAt of invalid){
      let transitions=0;
      const result=await reconcileContinuumTick({
        now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
        outbox:{
          observe:async()=>row({state,expiresAt}),
          markUnknown:async()=>{transitions++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
        }
      });
      assert.equal(result.status,'held-partial',expiresAt);
      assert.equal(result.receipts[0].disposition,'held-unknown',expiresAt);
      assert.equal(transitions,0,'invalid timestamp cannot cause reconciliation writes');
      assert.equal(result.externalDispatches,0);
    }
  }
});

test('RED: C02 scheduler clock requires an explicit bounded timezone before any storage access',async()=>{
  // Date.parse accepts local-time strings and +14:30, making recovery
  // eligibility depend on a worker timezone or an invalid offset.
  for(const now of [
    '2026-11-01T12:00:00',
    '2026-11-01 12:00:00',
    '2026-11-01T12:00:00+14:30',
    '2026-11-01T24:00:00Z'
  ]){
    let controlReads=0,queueReads=0,writes=0;
    await assert.rejects(reconcileContinuumTick({
      now,
      readControl:async()=>{controlReads++;return control();},
      listDue:async()=>{queueReads++;return [delivery];},
      outbox:{
        observe:async()=>row(),
        markUnknown:async()=>{writes++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
      }
    }),/continuum-recovery-time-invalid/,now);
    assert.equal(controlReads,0,'reject untrusted clock before control read');
    assert.equal(queueReads,0,'reject untrusted clock before due queue');
    assert.equal(writes,0,'no reconciliation writes from untrusted clock');
  }
});


test('RED: C02 SLO target cannot be lowered below the mandatory 99.5% seven-day release objective',()=>{
  const start=Date.parse('2026-10-25T12:00:00Z');
  const runs=Array.from({length:168},(_,i)=>({
    scheduledAt:new Date(start+i*60*60*1000).toISOString(),
    success:i!==100,source:'scheduler'
  }));
  const args={startAt:new Date(start).toISOString(),
    endAt:new Date(start+168*60*60*1000).toISOString(),runs};
  const baseline=measureObservedSchedulerSlo(args);
  assert.equal(baseline.evidenceComplete,true);
  assert.equal(baseline.successfulSlots,167);
  assert.equal(baseline.meetsTarget,false);
  // A caller-supplied 50% threshold must not certify a failed 99.5% pilot.
  assert.throws(()=>measureObservedSchedulerSlo({...args,target:0.5}),
    /continuum-slo-input-invalid/);
});

test('RED: C02 rejects a mismatched or unverified markUnknown receipt',async()=>{
  // C01's actual markUnknown contract includes a durable delivery identity
  // and a boolean CAS outcome. An adapter returning a foreign or bare state
  // must not be allowed to certify the target delivery's reconciliation.
  const malformed=[
    {state:'reconcile-required'},
    {changed:true,deliveryId:'continuum:foreign-0001',state:'reconcile-required'},
    {changed:'true',deliveryId:delivery,state:'reconcile-required'},
    {changed:true,deliveryId:delivery,state:'pending'}
  ];
  for(const returned of malformed){
    let transitions=0;
    const result=await reconcileContinuumTick({
      now:NOW,readControl:async()=>control(),listDue:async()=>[delivery],
      outbox:{
        observe:async()=>row(),
        markUnknown:async()=>{transitions++;return returned;}
      }
    });
    assert.equal(transitions,1,'a single fenced CAS attempt is allowed');
    assert.equal(result.status,'held-partial');
    assert.equal(result.receipts[0].disposition,'held-unknown',
      'unverified state must not certify reconciliation');
    assert.equal(result.externalDispatches,0);
  }
});


test('C02 revoked or malformed control cannot transition durable recovery state',async()=>{
  // Revocation must be enforced at the scheduler admission boundary,
  // not silently ignored when the control is loaded from storage.
  for(const revoked of [true,undefined,null,'false',0,1]){
    let queueReads=0,observations=0,transitions=0;
    const result=await reconcileContinuumTick({
      now:NOW,readControl:async()=>control({revoked}),
      listDue:async()=>{queueReads++;return [delivery];},
      outbox:{
        observe:async()=>{observations++;return row();},
        markUnknown:async()=>{transitions++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
      }
    });
    assert.equal(result.status,'held-revoked',
      'missing, malformed or revoked control must fail closed');
    assert.equal(queueReads,0,'do not read due work after revocation');
    assert.equal(observations,0,'do not inspect a revoked delivery');
    assert.equal(transitions,0,'do not transition a revoked delivery');
    assert.equal(result.externalDispatches,0);
  }
});

test('RED: C02 rechecks owner authority after async outbox observation before CAS',async()=>{
  // Authority can change while the database observation is in flight. An
  // initial admission check is not permission to transition a stale lease.
  for(const revoked of [{revoked:true},{paused:true},{maxPaidCents:1},{paidFallback:true}]){
    let controlReads=0,writes=0;
    const result=await reconcileContinuumTick({
      now:NOW,
      readControl:async()=>{controlReads++;return control(controlReads===1?{}:revoked);},
      listDue:async()=>[delivery],
      outbox:{
        observe:async()=>row(),
        markUnknown:async()=>{writes++;return {changed:true,deliveryId:delivery,state:'reconcile-required'};}
      }
    });
    assert.equal(controlReads,2,'must re-read authority immediately before CAS');
    assert.equal(writes,0,'revoked or metered authority cannot transition outbox');
    assert.equal(result.status,'held-partial');
    assert.equal(result.receipts[0].disposition,'held-unknown');
    assert.equal(result.externalDispatches,0);
  }
});
