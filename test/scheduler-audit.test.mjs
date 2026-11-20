import test from 'node:test';
import assert from 'node:assert/strict';
import {readSchedulerAudit} from '../cloud/hatchable/lib/scheduler-audit.js';

const fixture={expected_slots:24,recorded_slots:23,missing_slots:1,
 completed_slots:22,pending_slots:1,historical_reconciled:20,
 pickup_slo_breaches:21,on_time_first_attempt_candidates:2};

test('BUG-184 audit separates missing, pending, historical repairs and clean first-attempt candidates',async()=>{
 let calls=0;
 const db={async query(sql,params){
  calls++;
  assert.deepEqual(params,[24]);
  assert.match(sql,/generate_series/);
  assert.match(sql,/historicalReconciliation/);
  assert.match(sql,/repo_attempts=1 AND council_attempts=1/);
  assert.doesNotMatch(sql,/UPDATE brain_scheduler_slots/);
  return {rows:[fixture]};
 }};
 const result=await readSchedulerAudit({db,windowHours:24});
 assert.deepEqual(result,{windowHours:24,expectedSlots:24,recordedSlots:23,
  missingSlots:1,completedSlots:22,pendingSlots:1,historicalReconciled:20,
  pickupSloBreaches:21,onTimeFirstAttemptCandidates:2});
 assert.equal(calls,1);
 assert.equal(Object.isFrozen(result),true);
});

test('BUG-184 rejects unsafe windows and non-read database access',async()=>{
 for(const windowHours of [0,1,25,167,169,'24',null]){
  await assert.rejects(()=>readSchedulerAudit({db:{query:async()=>({rows:[fixture]})},windowHours}),/invalid-scheduler-audit-input/);
 }
 await assert.rejects(()=>readSchedulerAudit({db:{},windowHours:24}),/invalid-scheduler-audit-input/);
});

test('BUG-184 rejects inconsistent or malformed aggregates rather than producing false SLO receipts',async()=>{
 for(const bad of [{...fixture,missing_slots:2},{...fixture,on_time_first_attempt_candidates:23},
  {...fixture,expected_slots:'NaN'}, {...fixture,completed_slots:-1}]){
  await assert.rejects(()=>readSchedulerAudit({db:{query:async()=>({rows:[bad]})},windowHours:24}),
   /scheduler-audit-inconsistent|invalid-scheduler-aggregate/);
 }
});

test('BUG-184 168-hour window is supported without claiming acceptance',async()=>{
 const db={query:async(sql,params)=>{
  assert.deepEqual(params,[168]);
  return {rows:[{...fixture,expected_slots:168,missing_slots:145}]};
 }};
 const result=await readSchedulerAudit({db,windowHours:168});
 assert.equal(result.expectedSlots,168);
 assert.equal(result.onTimeFirstAttemptCandidates,2);
});
