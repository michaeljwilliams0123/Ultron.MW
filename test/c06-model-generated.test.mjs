/* Ultron model-generated test vectors; deterministic Node test wrapper. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyC06Effect as fix} from '../lib/c06-model-candidate.js';
const generated = [
  {
    "input": {
      "authorized": true,
      "paused": false,
      "paidCents": 0,
      "providerStatus": "observed",
      "receiptVerified": true
    },
    "expected": "verified"
  },
  {
    "input": {
      "authorized": true,
      "paused": false,
      "paidCents": 0,
      "providerStatus": "unknown",
      "receiptVerified": false
    },
    "expected": "reconcile"
  },
  {
    "input": {
      "authorized": true,
      "paused": false,
      "paidCents": 0,
      "providerStatus": "timeout",
      "receiptVerified": false
    },
    "expected": "reconcile"
  },
  {
    "input": {
      "authorized": true,
      "paused": true,
      "paidCents": 0,
      "providerStatus": "observed",
      "receiptVerified": true
    },
    "expected": "held"
  },
  {
    "input": {
      "authorized": false,
      "paused": false,
      "paidCents": 0,
      "providerStatus": "observed",
      "receiptVerified": true
    },
    "expected": "held"
  },
  {
    "input": {
      "authorized": true,
      "paused": false,
      "paidCents": 1,
      "providerStatus": "observed",
      "receiptVerified": true
    },
    "expected": "held"
  },
  {
    "input": {
      "authorized": true,
      "paused": false,
      "paidCents": 0,
      "providerStatus": "observed",
      "receiptVerified": false
    },
    "expected": "held"
  }
];
test('C06 model-generated owner-effect regression vectors',()=>{
 for(const row of generated)assert.equal(fix(row.input),row.expected);
});
