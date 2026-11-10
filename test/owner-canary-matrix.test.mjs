import test from 'node:test';
import assert from 'node:assert/strict';
import {runOwnerCanaryMatrix} from '../scripts/owner-canary-matrix.mjs';
test('existing isolated canary branch can be read back without another write',async()=>{
 const result=await runOwnerCanaryMatrix({mode:'inspect',env:{},targetRunId:'42827178057',request:async()=>{throw Error('never');}});
 assert.equal(result.status,'held');
});
