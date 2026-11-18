import test from 'node:test';
import assert from 'node:assert/strict';
import { executeUniversalCloudTask } from '../src/universal-cloud-executor.mjs';

const NOW = '2026-11-17T23:00:00Z';
const task = {
  provider:'gitlab', operation:'gitlab.branch.create',
  target:'project:87884831:branch:ultron-task-1',
  idempotencyKey:'cloud:gitlab:trust-test-001',
  expectedStopVersion:5,
  payload:{branch:'ultron-task-1',ref:'main'},
  estimatedCostCents:0,
};
const grant={
  verified:true,actor:'michaeljwilliams0123',provider:'gitlab',
  operation:'gitlab.branch.create',
  target:'project:87884831:branch:ultron-task-1',
  expiresAt:'2026-11-17T23:10:00Z',maxPaidCents:0,
};
function fakes() {
  let writes=0;
  return {
    get writes(){return writes;},
    outboxStore:{
      async reserve(){return {ok:true,fencingEpoch:5};},
      async markReconcile(){return {ok:true};},
      async markCompleted(){return {verified:true};},
    },
    async submitProvider(){writes++;return {ok:true,externalId:'gl-1'};},
    async readbackProvider({expectedDigest}){
      return {verified:true,digest:expectedDigest};
    },
  };
}
test('untrusted verified:true grant cannot authorize a provider write without signed proof',async()=>{
  const f=fakes();
  const result=await executeUniversalCloudTask({
    task,ownerGrant:grant,runtimeControl:{paused:false,stopVersion:5},
    ...f,now:NOW,
  });
  assert.equal(result.ok,false);
  assert.equal(f.writes,0);
});
test('unknown paid cost fails closed before any external write',async()=>{
  const f=fakes();
  const {estimatedCostCents,...taskWithUnknownCost}=task;
  const result=await executeUniversalCloudTask({
    task:taskWithUnknownCost,ownerGrant:grant,
    runtimeControl:{paused:false,stopVersion:5},...f,now:NOW,
  });
  assert.equal(result.ok,false);
  assert.equal(f.writes,0);
});
test('self-attested callback readback without provider-origin receipt cannot complete',async()=>{
  const f=fakes();
  const result=await executeUniversalCloudTask({
    task,ownerGrant:grant,runtimeControl:{paused:false,stopVersion:5},
    ...f,now:NOW,
  });
  assert.notEqual(result.status,'completed');
});
