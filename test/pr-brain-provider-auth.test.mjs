import test from 'node:test';
import assert from 'node:assert/strict';
import {routePrTurn} from '../src/pr-brain.mjs';
test('owner PR comments can inspect provider authorization without minting credentials',()=>{
  assert.deepEqual(routePrTurn('@ultron credentials datadog'),
    {kind:'credentials',provider:'datadog'});
  assert.deepEqual(routePrTurn('@ultron credentials huggingface'),
    {kind:'credentials',provider:'huggingface'});
});
