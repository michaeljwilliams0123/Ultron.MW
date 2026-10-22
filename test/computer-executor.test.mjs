import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeComputerPlan, createComputerExecutor, createMemoryComputerStore
} from '../src/computer/executor.mjs';
import { createFileComputerStore } from '../src/computer/file-store.mjs';
import { createPlaywrightComputerDriver } from '../src/computer/playwright-driver.mjs';

const allowedOrigins = ['https://example.test'];
const plan = steps => ({ id: 'check-001', steps });
function harness({ authorization = async () => false, fail = false } = {}) {
  let count = 0;
  const state = { url: 'https://example.test/start', text: 'Ready', title: 'Sandbox' };
  const driver = {
    async observe() { return { ...state }; },
    async perform(step) {
      count++;
      if (fail) throw Error('page disconnected');
      if (step.action === 'navigate') state.url = step.url;
      if (step.action === 'type') state.text = 'Stored result';
      if (step.action === 'click') state.text = 'Submitted';
      return null;
    }
  };
  return { driver, get count() { return count; },
    executor: store => createComputerExecutor({
      driver, store, authorize: authorization, allowedOrigins,
      clock: () => '2026-10-21T00:00:00Z',
    }) };
}
test('navigation and observable state complete with an evidence digest', async () => {
  const h = harness();
  const result = await h.executor(createMemoryComputerStore()).run(plan([
    { id: 'open', action: 'navigate', url: 'https://example.test/hello',
      expect: { urlIncludes: '/hello' } },
    { id: 'check', action: 'observe', expect: { textIncludes: 'Ready' } },
  ]));
  assert.equal(result.status, 'completed');
  assert.equal(result.receipts.length, 2);
  assert.match(result.receipts[0].observationDigest, /^[0-9a-f]{64}$/);
});
test('click and typing require independent positive authorization', async () => {
  const h = harness();
  const out = await h.executor(createMemoryComputerStore()).run(plan([
    { action: 'click', selector: '#submit' },
  ]));
  assert.equal(out.status, 'approval-required');
  assert.equal(h.count, 0);
});
test('authorized typing runs once and stores only a digest', async () => {
  const h = harness({ authorization: async () => true });
  const store = createMemoryComputerStore();
  const p = plan([{ action: 'type', selector: '#value', value: 'secret-value',
    expect: { textIncludes: 'Stored result' } }]);
  const once = await h.executor(store).run(p);
  assert.equal(once.status, 'completed');
  assert.equal(h.count, 1);
  const second = await h.executor(store).run(p);
  assert.equal(second.resumed, true);
  assert.equal(h.count, 1);
  assert.equal(JSON.stringify(await store.read(p.id)).includes('secret-value'), false);
});
test('unknown origin is rejected before dispatch', async () => {
  const h = harness();
  await assert.rejects(
    h.executor(createMemoryComputerStore()).run(plan([
      { action: 'navigate', url: 'https://other.test/path' }
    ])), /origin/);
  assert.equal(h.count, 0);
});
test('HTTP on a non-loopback origin is rejected', () => {
  assert.throws(() => normalizeComputerPlan(plan([
    { action: 'navigate', url: 'http://example.test' }
  ]), { allowedOrigins: ['http://example.test'] }), /origin/);
});
test('duplicate step IDs and unknown tools fail closed', () => {
  assert.throws(() => normalizeComputerPlan(plan([
    { id: 'x', action: 'observe' }, { id: 'x', action: 'observe' }
  ]), { allowedOrigins }), /Duplicate/);
  assert.throws(() => normalizeComputerPlan(plan([
    { action: 'shell', command: 'echo hello' }
  ]), { allowedOrigins }), /Unknown/);
});
test('ambiguous action result is never automatically replayed', async () => {
  const h = harness({ fail: true });
  const store = createMemoryComputerStore();
  const p = plan([{ action: 'navigate', url: 'https://example.test/next' }]);
  assert.equal((await h.executor(store).run(p)).status, 'reconcile-required');
  assert.equal((await h.executor(store).run(p)).status, 'reconcile-required');
  assert.equal(h.count, 1);
});
test('plan identifier cannot silently change the objective', async () => {
  const h = harness();
  const store = createMemoryComputerStore();
  await h.executor(store).run(plan([{ action: 'observe' }]));
  await assert.rejects(h.executor(store).run(plan([
    { action: 'navigate', url: 'https://example.test/other' }
  ])), /reused/);
});
test('durable checkpoint survives store reconstruction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-computer-'));
  try {
    const h = harness();
    const p = plan([{ action: 'observe' }]);
    const first = await h.executor(createFileComputerStore(dir)).run(p);
    assert.equal(first.status, 'completed');
    const second = await h.executor(createFileComputerStore(dir)).run(p);
    assert.equal(second.resumed, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Playwright adapter translates actual page interaction methods', async () => {
  const calls = [];
  const locator = selector => ({
    click: async () => { calls.push(['click', selector]); },
    fill: async value => { calls.push(['fill', selector, value]); },
    press: async key => { calls.push(['press', selector, key]); },
    innerText: async () => 'Observed',
    waitFor: async () => { calls.push(['wait', selector]); },
  });
  const page = {
    url: () => 'https://example.test',
    title: async () => 'Sandbox',
    locator,
    goto: async url => { calls.push(['goto', url]); },
    mouse: { wheel: async (x,y) => { calls.push(['wheel',x,y]); } },
  };
  const driver = createPlaywrightComputerDriver(page);
  await driver.perform({ action: 'click', selector: 'button' });
  await driver.perform({ action: 'type', selector: 'input', value: 'hello' });
  await driver.perform({ action: 'navigate', url: 'https://example.test' });
  await driver.perform({ action: 'scroll', pixels: 150 });
  assert.deepEqual(calls, [
    ['click','button'], ['fill','input','hello'],
    ['goto','https://example.test'], ['wheel',0,150],
  ]);
  assert.equal((await driver.observe()).title, 'Sandbox');
});
