import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchHeadlessTask} from '../scripts/execute-autonomous-task.mjs';

const valid={
  taskId:'smoke-test-01',targetBranch:'ultron/canary-smoke-test',
  sourceSha:'a'.repeat(40),operationDigest:'b'.repeat(64),
  requiresResponse:true,enforceSignedApproval:true,prepareOnly:true,
};

test('advertises Task 3 preparation support for the five-stage conductor',()=>{
  assert.equal(dispatchHeadlessTask.supportsPrepareOnly,true);
});

test('prepare-only gives Task 4 an immutable data-only context, never invokes a graph',async()=>{
  let graphCalls=0;
  const prepared=await dispatchHeadlessTask(' Verify one branch ',{
    ...valid,runGraph:()=>{graphCalls++;throw Error('graph-must-not-run');},
    now:()=>{throw Error('clock-must-not-run');},
    newId:()=>{throw Error('random-id-must-not-run');},
  });
  assert.deepEqual(prepared,{stage:'prepared',taskId:valid.taskId,
    targetBranch:valid.targetBranch,sourceSha:valid.sourceSha,
    operationDigest:valid.operationDigest});
  assert.equal(Object.hasOwn(prepared,'authorized'),false);
  assert.equal(Object.hasOwn(prepared,'token'),false);
  assert.equal(Object.hasOwn(prepared,'signature'),false);
  assert.ok(Object.isFrozen(prepared));
  assert.equal(graphCalls,0);
});

test('prepare-only refuses false or missing signed-approval flags',async()=>{
  for(const patch of [{enforceSignedApproval:false},{requiresResponse:false},
    {enforceSignedApproval:'true'},{requiresResponse:1},
    {enforceSignedApproval:undefined}]){
    await assert.rejects(dispatchHeadlessTask('Canary',{...valid,...patch}),
      /headless-preparation-invalid/);
  }
});

test('prepare-only rejects malformed task, repository branch, SHA and digest',async()=>{
  for(const patch of [
    {taskId:'wrong'},{taskId:'..danger'},{taskId:'bad/branch'},
    {targetBranch:'refs/heads/main'},{targetBranch:'canary/autonomous-run-unsafe'},
    {targetBranch:'ultron/canary-../../main'},
    {sourceSha:'z'.repeat(40)},{sourceSha:'a'.repeat(39)},
    {operationDigest:'0'.repeat(63)},{operationDigest:'f'.repeat(65)},
    {targetBranch:{toString(){throw Error('coercion-executed');}}},
  ]){
    await assert.rejects(dispatchHeadlessTask('Canary',{...valid,...patch}),
      /headless-preparation-invalid/);
  }
});

test('objective length and signed boundary do not manufacture authority',async()=>{
  await assert.rejects(dispatchHeadlessTask('x'.repeat(801),{...valid}),
    /headless-objective-invalid/);
  const prepared=await dispatchHeadlessTask('verify',{...valid});
  assert.equal(prepared.stage,'prepared');
  assert.equal(Object.hasOwn(prepared,'enforceSignedApproval'),false);
});

test('graph mode rejects unexpected preparation metadata before any dispatch',async()=>{
  let graphCalls=0;
  await assert.rejects(dispatchHeadlessTask('Canary',{
    prepareOnly:false,taskId:valid.taskId,
    runGraph:()=>{graphCalls++;},
  }),/headless-preparation-invalid/);
  assert.equal(graphCalls,0);
});
