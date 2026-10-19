import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateCounterfactual } from '../src/cognitive-world-model.mjs';

test('counterfactual transition is deterministic and does not mutate observed state', () => {
  const observed = { queueDepth: 4, failureRate: 0.2 };
  const action = {
    actionId: 'recover-capacity',
    effects: { queueDepth: -2, failureRate: -0.05 },
    uncertainty: 0.1,
  };
  const first = simulateCounterfactual({ observedState: observed, stateUncertainty: 0.15, action });
  const second = simulateCounterfactual({ observedState: observed, stateUncertainty: 0.15, action });
  assert.deepEqual(first, second);
  assert.deepEqual(observed, { queueDepth: 4, failureRate: 0.2 });
  assert.equal(first.predictedState.queueDepth, 2);
  assert.equal(first.predictedUncertainty, 0.25);
});

test('world model refuses undeclared effects and propagates bounded uncertainty', () => {
  assert.throws(() => simulateCounterfactual({
    observedState: { load: 1 },
    stateUncertainty: 0.9,
    action: { actionId: 'x', effects: { unknown: 1 }, uncertainty: 0.9 },
  }), /world-model-effect-unknown/);
});
