import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalServer } from '../src/server.mjs';

test('local runtime restores persistent server and standby endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ultron-standby-http-'));
  const app = await startLocalServer({
    root: resolve(import.meta.dirname, '..'),
    statePath: join(directory, 'state.json'), port: 0, alwaysOn: true,
  });
  try {
    const base = 'http://127.0.0.1:' + app.port;
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.executionReady, true);
    assert.equal(health.standby.enabled, true);
    assert.equal(health.standby.posture, 'waiting-for-owner');
    const standby = await (await fetch(base + '/api/standby')).json();
    assert.equal(standby.receipt.kind, 'ultron-standby-receipt');
    assert.equal(standby.receipt.authority.executable, false);
    assert.equal(standby.receipt.modelInvocations, 0);
    assert.equal(standby.recent.count,1);
    assert.equal(standby.recent.latest.modelInvocations,0);
    assert.equal(standby.recent.latest.creditCost,0);
    const capabilities = await (await fetch(base + '/api/capabilities')).json();
    assert.equal(capabilities.runtime, 'local');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
