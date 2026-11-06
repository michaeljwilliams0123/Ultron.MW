import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolSynthesizer } from '../src/autonomy/tool-synthesizer.mjs';

const draft = {
  toolName: 'ultron_telemetry',
  handler: 'throw new Error("generated code must not run");',
  tests: 'throw new Error("generated tests must not run");'
};

test('proposals are deterministic and generated code remains inert', async () => {
  let calls = 0;
  const synth = new ToolSynthesizer({ generate: async ({ objective }) => {
    assert.equal(objective, 'Read build telemetry');
    calls++;
    return draft;
  } });
  const a = await synth.propose({ objective: 'Read build telemetry' });
  const b = await synth.propose({ objective: 'Read build telemetry' });
  assert.equal(calls, 2);
  assert.deepEqual(a, b);
  assert.equal(a.status, 'proposed');
  assert.match(a.proposalSha256, /^[a-f0-9]{64}$/);
  assert.equal(a.handler, draft.handler);
  assert.equal(a.tests, draft.tests);
});

test('proposal digest binds objective, tool name, handler and tests', async () => {
  const proposal = (change = {}, objective = 'A') =>
    new ToolSynthesizer({ generate: async () => ({ ...draft, ...change }) }).propose({ objective });
  const original = await proposal();
  for (const changed of [
    await proposal({}, 'B'),
    await proposal({ toolName: 'ultron_other' }),
    await proposal({ handler: 'different' }),
    await proposal({ tests: 'different' })
  ]) assert.notEqual(changed.proposalSha256, original.proposalSha256);
});

test('invalid input and oversized generator output fail before any promotion', async () => {
  assert.throws(() => new ToolSynthesizer(), /generator-required/);
  let calls = 0;
  const synth = new ToolSynthesizer({ generate: async () => { calls++; return draft; } });
  for (const objective of ['', ' ', 'x'.repeat(4097), 12]) {
    await assert.rejects(synth.propose({ objective }), /invalid-objective/);
  }
  assert.equal(calls, 0);
  for (const [change, error] of [
    [{ toolName: '../escape' }, /invalid-tool-name/],
    [{ handler: '' }, /invalid-handler/],
    [{ handler: 'x'.repeat(65537) }, /invalid-handler/],
    [{ tests: 'x'.repeat(65537) }, /invalid-tests/]
  ]) {
    const bad = new ToolSynthesizer({ generate: async () => ({ ...draft, ...change }) });
    await assert.rejects(bad.propose({ objective: 'A' }), error);
  }
});

test('generator failures are propagated', async () => {
  const failure = new Error('generator unavailable');
  const synth = new ToolSynthesizer({ generate: async () => { throw failure; } });
  await assert.rejects(synth.propose({ objective: 'A' }), error => error === failure);
});
