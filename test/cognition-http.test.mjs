import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startLocalServer } from '../src/server.mjs';

test('saved plans include bounded GrokBot cognition without gaining execution authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ultron-cognition-'));
  const statePath = join(directory, 'state.json');
  const app = await startLocalServer({ root: resolve(import.meta.dirname, '..'), statePath, port: 0 });
  try {
    const origin = 'http://127.0.0.1:' + app.port;
    const result = await fetch(origin + '/api/plan', {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-ultron-client': 'local-ui-v1',
      },
      body: JSON.stringify({ text: 'inspect repo' }),
    });
    assert.equal(result.status, 201);
    const body = await result.json();
    assert.equal(body.executed, false);
    assert.equal(body.plan.cognition.kind, 'grokbot-deliberation-receipt');
    assert.equal(body.plan.cognition.decision, 'proceed');
    assert.equal(body.plan.cognition.authority.executable, false);
    assert.equal(body.plan.cognition.modelInvocations, 0);
    assert.equal(body.plan.cognition.creditCost, 0);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
