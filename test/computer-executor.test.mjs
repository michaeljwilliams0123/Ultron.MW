import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeComputerPlan, createComputerExecutor, createMemoryComputerStore
} from '../src/computer/executor.mjs';
import { createFileComputerStore } from '../src/computer/file-store.mjs';
import { createPlaywrightComputerDriver, installNetworkPolicy } from '../src/computer/playwright-driver.mjs';

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
      return step.action === 'type' ? { fieldValueVerified: true } : null;
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
    { action: 'click', selector: '#submit', expect: { textIncludes: 'Submitted' } },
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
    inputValue: async () => 'hello',
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

test('interactive effects cannot pretend verification without a postcondition', async () => {
  const h = harness({ authorization: async () => true });
  await assert.rejects(h.executor(createMemoryComputerStore()).run(plan([
    { action: 'click', selector: '#submit' },
  ])), /postcondition/);
  assert.equal(h.count, 0);
});
test('post-effect checkpoint failure never makes an uncertain action replayable', async () => {
  const h = harness({ authorization: async () => true });
  const inner = createMemoryComputerStore();
  let writes = 0, failOne = true;
  const store = {
    read: inner.read,
    async write(id, data) {
      writes++;
      if (writes === 2 && failOne) { failOne = false; throw Error('Disk full after action'); }
      return inner.write(id, data);
    },
  };
  const p = plan([{ action: 'click', selector: '#submit',
    expect: { textIncludes: 'Submitted' } }]);
  const first = await h.executor(store).run(p);
  assert.equal(first.status, 'reconcile-required');
  assert.equal((await inner.read(p.id)).pending, 'step-1');
  assert.equal((await h.executor(store).run(p)).status, 'reconcile-required');
  assert.equal(h.count, 1);
});
test('concurrent in-memory runs cannot dispatch the same objective twice', async () => {
  const store = createMemoryComputerStore();
  let dispatch = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const driver = {
    observe: async () => ({ url: 'https://example.test', text: 'Ready' }),
    perform: async () => { dispatch++; await gate; },
  };
  const runner = createComputerExecutor({ driver, store, allowedOrigins });
  const p = plan([{ action: 'observe' }]);
  const first = runner.run(p);
  await Promise.resolve();
  await assert.rejects(runner.run(p), /already running/);
  release();
  assert.equal((await first).status, 'completed');
  assert.equal(dispatch, 1);
});
test('filesystem objective lock excludes a second writer and allows later runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-lease-'));
  try {
    const a = createFileComputerStore(dir), b = createFileComputerStore(dir);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const first = a.withLock('same-task', () => gate);
    await new Promise(resolve => setTimeout(resolve, 25));
    await assert.rejects(b.withLock('same-task', () => 'no'), /lock exists/);
    release();
    await first;
    assert.equal(await b.withLock('same-task', () => 'ok'), 'ok');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('process death leaves the objective lock for explicit reconciliation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ultron-crash-lock-'));
  const moduleUrl = new URL('../src/computer/file-store.mjs', import.meta.url).href;
  const source = `
    const { createFileComputerStore } = await import(process.argv[1]);
    const store = createFileComputerStore(process.argv[2]);
    await store.withLock('crash-task', async () => {
      process.stdout.write('LOCKED\\n');
      await new Promise(() => {});
    });`;
  const child = spawn(process.execPath,
    ['--input-type=module', '-e', source, moduleUrl, dir],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Child did not acquire lock')), 5000);
      child.once('error', reject);
      child.stdout.on('data', chunk => {
        if (String(chunk).includes('LOCKED')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    child.kill('SIGKILL');
    await once(child, 'exit');
    await assert.rejects(
      createFileComputerStore(dir).withLock('crash-task', async () => 'unsafe'),
      /requires reconciliation/,
    );
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});
test('origin interception rejects disallowed browser requests and WebSockets', async () => {
  let intercept, socketRule, closed = false;
  const context = {
    async route(pattern, callback) { assert.equal(pattern, '**/*'); intercept = callback; },
    async routeWebSocket(pattern, callback) { socketRule = callback; },
  };
  await installNetworkPolicy(context, ['https://example.test']);
  const events = [];
  const route = url => ({
    request: () => ({ url: () => url }),
    fetch: async options => {
      assert.equal(options.maxRedirects, 0);
      return {
        status: () => url.includes('redirect') ? 302 : 200,
        headers: () => url.includes('redirect') ?
          { location: url.includes('allowed') ? '/safe' :
            'https://example.evil/private' } : {},
      };
    },
    fulfill: async () => events.push('continued'),
    abort: async () => events.push('blocked'),
  });
  await intercept(route('https://example.test/resource.js'));
  await intercept(route('https://example.test/redirect'));
  await intercept(route('https://example.test/allowed-redirect'));
  await intercept(route('https://example.evil/resource.js'));
  await intercept(route('http://127.0.0.1/admin'));
  assert.deepEqual(events, ['continued', 'blocked', 'blocked', 'blocked', 'blocked']);
  await socketRule({ close: () => { closed = true; } });
  assert.equal(closed, true);
});
test('unchanged interactive screen never counts as a successful click', async () => {
  let calls = 0;
  const h = createComputerExecutor({
    driver: {
      observe: async () => ({ url: 'https://example.test', title: 'Same', text: 'Ready' }),
      perform: async () => { calls++; },
    },
    allowedOrigins, store: createMemoryComputerStore(),
    authorize: async () => true,
  });
  const p = plan([{ action: 'click', selector: 'button',
    expect: { textIncludes: 'Done' } }]);
  assert.equal((await h.run(p)).status, 'reconcile-required');
  assert.equal((await h.run(p)).status, 'reconcile-required');
  assert.equal(calls, 1);
});
test('pre-existing postcondition cannot certify an unrelated page change', async () => {
  let calls = 0;
  const h = createComputerExecutor({
    driver: {
      observe: async () => ({ url: 'https://example.test',
        title: calls ? 'Clock 2' : 'Clock 1', text: 'Submitted' }),
      perform: async () => { calls++; },
    },
    allowedOrigins, store: createMemoryComputerStore(),
    authorize: async () => true,
  });
  await assert.rejects(h.run(plan([{ action: 'click', selector: 'button',
    expect: { textIncludes: 'Submitted' } }])), /already satisfied/);
  assert.equal(calls, 0);
});
test('keypress authorization discloses the requested key', async () => {
  let requested;
  const h = createComputerExecutor({
    driver: {
      observe: async () => ({ url: 'https://example.test', title: 'Form', text: 'Ready' }),
      perform: async () => { throw Error('must not dispatch'); },
    },
    allowedOrigins, store: createMemoryComputerStore(),
    authorize: async context => { requested = context; return false; },
  });
  const result = await h.run(plan([{ action: 'keypress', selector: 'input',
    key: 'Enter', expect: { textIncludes: 'Submitted' } }]));
  assert.equal(result.status, 'approval-required');
  assert.equal(requested.key, 'Enter');
});
test('browser startup fails closed when WebSocket interception is unavailable', async () => {
  await assert.rejects(installNetworkPolicy({ route: async () => {} },
    ['https://example.test']), /lacks WebSocket/);
});
test('invalid action properties and noncanonical origins are rejected', () => {
  assert.throws(() => normalizeComputerPlan(plan([
    { action: 'observe', injected: true },
  ]), { allowedOrigins }), /property/);
  assert.throws(() => normalizeComputerPlan(plan([
    { action: 'observe' },
  ]), { allowedOrigins: ['https://example.test/secret'] }), /allowlist/);
});

test('network interception aborts failed fetch and missing runtime fetch capabilities', async () => {
  let handler;
  await installNetworkPolicy({
    route: async (_, callback) => { handler = callback; },
    routeWebSocket: async () => {},
  }, ['https://example.test']);
  const aborted = [];
  const route = {
    request: () => ({ url: () => 'https://example.test/ok' }),
    fetch: async () => { throw Error('connection reset'); },
    abort: async reason => { aborted.push(reason); },
    fulfill: async () => { throw Error('must not fulfill'); },
  };
  await handler(route);
  assert.deepEqual(aborted, ['failed']);
  await handler({ ...route, fetch: undefined });
  assert.deepEqual(aborted, ['failed', 'blockedbyclient']);
});
