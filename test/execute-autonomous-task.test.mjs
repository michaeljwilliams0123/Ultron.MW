import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchHeadlessTask } from '../scripts/execute-autonomous-task.mjs';

test('passes signed-approval and response flags to the graph runner', async () => {
  let observed;
  const graphResult = {status: 'held', reason: 'owner-grant-required'};
  const result = await dispatchHeadlessTask('Verify source and CI', {
    runGraph: async context => {observed = context; return graphResult;},
    now: () => 1794286320000,
    newId: () => '12345678-1234-4234-8234-123456789abc',
  });
  assert.equal(result, graphResult);
  assert.deepEqual(observed, {
    taskId: 'canary-exec-1794286320000-12345678-1234-4234-8234-123456789abc',
    objective: 'Verify source and CI',
    requiresResponse: true,
    enforceSignedApproval: true,
    targetBranch: 'canary/autonomous-run-1794286320000-12345678-1234-4234-8234-123456789abc',
  });
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(Object.hasOwn(observed,'authorized'), false);
});

test('defaults an empty CLI objective to infrastructure validation canary', async () => {
  let observed;
  await dispatchHeadlessTask('   ', {
    runGraph: async context => {observed = context; return {status:'planned'};},
    now: () => 1794286320001,
    newId: () => '12345678-1234-4234-8234-123456789abc',
  });
  assert.equal(observed.objective,'Default autonomous infrastructure validation canary');
});

test('rejects unbounded and malformed objectives before dispatch', async () => {
  let invoked=0;
  const runGraph=async()=>{invoked++;};
  for (const objective of ['x'.repeat(801), 'test\nnext step', 123, {objective:'test'}, '\u0000whoami']) {
    await assert.rejects(dispatchHeadlessTask(objective,{runGraph}), /headless-objective-invalid/);
  }
  assert.equal(invoked,0);
});

test('propagates graph authorization and execution failures without fabricating success', async () => {
  await assert.rejects(dispatchHeadlessTask('Perform canary',{
    runGraph: async () => {throw Error('owner-grant-required');},
  }), /owner-grant-required/);
});

test('generates unique branch/task ids even if invoked during the same millisecond', async () => {
  const seen=[];
  const ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  for(const id of ids)await dispatchHeadlessTask('Canary',{
    runGraph:async context=>{seen.push(context);return {status:'planned'};},
    now:()=>1794286320000,newId:()=>id,
  });
  assert.notEqual(seen[0].taskId,seen[1].taskId);
  assert.notEqual(seen[0].targetBranch,seen[1].targetBranch);
});

test('a missing or non-function graph runner fails closed', async () => {
  await assert.rejects(dispatchHeadlessTask('Canary',{runGraph:null}),/headless-graph-unavailable/);
});
