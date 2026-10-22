import test from 'node:test';
import assert from 'node:assert/strict';
import { validateComputerBinding, createBoundComputerExecutor } from '../src/computer/binding-contract.mjs';
import { createMemoryComputerStore } from '../src/computer/executor.mjs';

const binding = () => ({
  id: 'browser-test', kind: 'computer.browser', runtime: 'local-node',
  enabled: true, maxSteps: 3, allowedOrigins: ['https://example.test'],
  operations: ['observe', 'click'],
});
const driver = {
  observe: async () => ({ url: 'https://example.test/page', text: 'Visible', title: 'Test' }),
  perform: async () => null,
};
test('manifest records not-probed rather than pretending connection readiness', () => {
  const value = validateComputerBinding(binding());
  assert.equal(value.readiness, 'not-probed');
  assert.equal(value.schema, 'ultron.binding.v1');
});
test('credential strings and unknown fields are not accepted', () => {
  assert.throws(() => validateComputerBinding({
    ...binding(), secret: 'token',
  }), /manifest/);
  assert.throws(() => validateComputerBinding({
    ...binding(), credentialRef: 'my-plain-token',
  }), /manifest/);
});
test('disabled and non-admitted actions block before execution', async () => {
  assert.throws(() => createBoundComputerExecutor({
    binding: { ...binding(), enabled: false }, driver,
    store: createMemoryComputerStore(),
  }), /disabled/);
  const runner = createBoundComputerExecutor({
    binding: binding(), driver,
    store: createMemoryComputerStore(),
  });
  await assert.rejects(runner.run({
    id: 'x', steps: [{ action: 'type', selector: '#name', value: 'test' }],
  }), /exceeds binding/);
});
test('manifest enablement never grants click without trusted callback', async () => {
  const runner = createBoundComputerExecutor({
    binding: binding(), driver,
    store: createMemoryComputerStore(),
  });
  const result = await runner.run({
    id: 'click-1', steps: [{ action: 'click', selector: 'button',
      expect: { textIncludes: 'Submitted' } }],
  });
  assert.equal(result.status, 'approval-required');
});

