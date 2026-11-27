import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionCorps,EXECUTION_AGENTS} from '../src/execution-corps.mjs';
import {createAutonomousRepairPlan} from '../src/autonomous-repair-loop.mjs';

test('four execution agents are distinct and cannot mint authority',()=>{
 assert.deepEqual(EXECUTION_AGENTS.map(a=>a.id),['forge','medic','nexus','relay']);
 assert.ok(EXECUTION_AGENTS.every(a=>a.maxPaidCents===0));
 assert.ok(Object.isFrozen(EXECUTION_AGENTS));
});
test('unbound executors and unrecognized agents do not dispatch',async()=>{
 const corps=createExecutionCorps();
 for(const id of ['forge','medic','nexus','relay']){
  const request=id==='nexus'?{agent:id,task:{},ownerGrant:null,ownerApproval:null}:id==='relay'?{agent:id,query:{}}:{agent:id,plan:{}};
  assert.equal((await corps.execute(request)).status,'held');
 }
 assert.equal((await corps.execute({agent:'arbitrary-shell'})).status,'held');
});
test('Composio relay executes a fixed read and never upgrades an unverified response',async()=>{
 let calls=0;
 const query={profile:'multi-account',actor:'ultron-admin',grant:{id:'test'}};
 const corps=createExecutionCorps({composioWorker:{inspect:async q=>{
  calls++;assert.deepEqual(q,query);
  return {schema:'ultron.composio.v3.read-receipt',verified:true,effect:'read',actor:'ultron-admin',repositoryId:1424939667,receiptKey:'test-receipt'};
 }}});
 const r=await corps.execute({agent:'relay',query});
 assert.equal(r.status,'observed-read');assert.equal(r.productionAccepted,false);assert.equal(calls,1);
 assert.equal((await corps.execute({agent:'relay',query,tools:['write-anywhere']})).status,'held');
 assert.equal(calls,1);
 const bad=createExecutionCorps({composioWorker:{inspect:async()=>({verified:true,effect:'write'})}});
 assert.equal((await bad.execute({agent:'relay',query})).status,'reconcile-required');
});
test('Nexus executes existing cloud admission and denies paid or unsigned actions',async()=>{
 const corps=createExecutionCorps({cloudServices:{readRuntimeControl:async()=>({paused:false,stopVersion:7})}});
 const task={provider:'composio',operation:'test',target:'authorized-test',idempotencyKey:'test-corp-1',estimatedCostCents:1,expectedStopVersion:7};
 const result=await corps.execute({agent:'nexus',task,ownerGrant:null,ownerApproval:null});
 assert.equal(result.status,'held');assert.equal(result.productionAccepted,false);
});
test('Medic uses the existing durable coordinator and cannot begin an expired plan',async()=>{
 const at=Date.parse('2026-11-26T00:00:00Z');
 const plan=createAutonomousRepairPlan({id:'repair-corps-01',owner:'michaeljwilliams0123',repository:'michaeljwilliams0123/Ultron.MW',branch:'ultron/repair-corps-01',baseSha:'a'.repeat(40),objective:'Reproduce a bounded test defect',allowedPaths:['src/canary.mjs'],maxAttempts:3,maxPaidCents:0,paidFallback:false,expiresAt:new Date(at+1000).toISOString()},at);
 const never=async()=>{throw Error('must not dispatch');};
 const corps=createExecutionCorps({repairServices:{now:()=>at+2000,ledger:{claim:never,read:async()=>null,transition:never},repairer:{propose:never},patcher:{apply:never,observe:never},verifier:{start:never,observe:never}}});
 const r=await corps.execute({agent:'medic',plan});
 assert.equal(r.status,'held');assert.equal(r.result.reason,'plan-expired-no-checkpoint');assert.equal(r.productionAccepted,false);
});
test('a lost or uncertain executor response is not retried or called complete',async()=>{
 let count=0;
 const corps=createExecutionCorps({composioWorker:{inspect:async()=>{count++;throw Error('response lost');}}});
 const r=await corps.execute({agent:'relay',query:{profile:'multi-account',actor:'ultron-admin',grant:{}}});
 assert.equal(r.status,'reconcile-required');assert.equal(r.productionAccepted,false);assert.equal(count,1);
});
