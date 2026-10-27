import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaywrightComputerDriver } from '../src/computer/playwright-driver.mjs';
import { createBoundedMultipartBridge } from '../src/computer/multipart-bridge.mjs';
import { validateUploadFile } from '../src/computer/file-transfer.mjs';
import { createComputerExecutor, createMemoryComputerStore } from '../src/computer/executor.mjs';

const origin = 'https://example.test';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ultron-upload-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'canary.txt');
  await writeFile(path, 'approved canary');
  return { root, path, file: await validateUploadFile(path, root) };
}
function context() {
  return { closed: false, async close() { this.closed = true; } };
}
function page(ctx, target = {}) {
  const p = { currentUrl: origin + '/form', visits: [],
    url() { return this.currentUrl; }, context: () => ctx, locator: () => target,
    async goto(url) { assert.equal(ctx.closed, false); this.visits.push(url); this.currentUrl = url; },
  };
  const frame = { page: () => p };
  p.mainFrame = () => frame;
  return p;
}
async function consume(bridge, p, file, root) {
  const boundary = '----UltronApprovedBoundary123';
  bridge.arm(p, file, root, 'canary');
  bridge.approveSubmit(p, origin);
  const request = {
    frame: () => p.mainFrame(), url: () => origin + '/submit', method: () => 'POST',
    isNavigationRequest: () => true,
    headers: () => ({ 'content-type': 'multipart/form-data; boundary=' + boundary }),
    postDataBuffer: () => Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="canary"; filename="canary.txt"\r\n\r\n\r\n--' + boundary + '--\r\n'),
  };
  await bridge.rehydrate(request);
  return request;
}

test('a verified upload retires every old context before later steps use a clean context', async t => {
  const { root, file } = await fixture(t);
  const oldContext = context(), oldWindow = context();
  const p = page(oldContext), sibling = page(oldContext), window = page(oldWindow);
  const bridge = createBoundedMultipartBridge();
  const freshContext = context(), fresh = page(freshContext);
  const freshBridge = createBoundedMultipartBridge();
  let replacements = 0;
  const driver = createPlaywrightComputerDriver(p, {
    tabs: { primary: p, secondary: sibling }, windows: { 'window-secondary': window },
    uploadBridge: bridge, uploadRoot: root,
    createCleanSession: async () => {
      assert.equal(oldContext.closed, true); assert.equal(oldWindow.closed, true);
      replacements++;
      return { page: fresh, tabs: { primary: fresh }, windows: {}, uploadBridge: freshBridge };
    },
  });
  const request = await consume(bridge, p, file, root);
  assert.equal(bridge.authorizeReceiptNavigation(p, request, origin + '/receipt'), true);
  assert.equal(bridge.mustBlockRequest(p, { url: () => origin + '/receipt',
    method: () => 'GET', isNavigationRequest: () => true, frame: () => p.mainFrame() }), false);
  p.currentUrl = origin + '/receipt';
  await driver.completeStep();
  assert.equal(replacements, 1);
  assert.deepEqual(fresh.visits, [origin + '/receipt']);
  await driver.perform({ id: 'later', action: 'navigate', url: origin + '/later' });
  assert.deepEqual(p.visits, []);
  assert.deepEqual(fresh.visits, [origin + '/receipt', origin + '/later']);
  freshBridge.arm(fresh, file, root, 'canary');
  assert.equal(freshBridge.mustBlockRequest(fresh, { url: () => origin + '/later' }), true);
});

test('a direct upload response cannot carry a page-controlled URL into the clean context', async t => {
  const { root, file } = await fixture(t), ctx = context(), p = page(ctx);
  const fresh = page(context()), bridge = createBoundedMultipartBridge();
  const driver = createPlaywrightComputerDriver(p, { uploadBridge: bridge,
    createCleanSession: async () => ({ page: fresh, tabs: { primary: fresh },
      windows: {}, uploadBridge: createBoundedMultipartBridge() }),
  });
  await consume(bridge, p, file, root);
  p.currentUrl = origin + '/leak?selected=private-bytes';
  await driver.completeStep();
  assert.equal(ctx.closed, true);
  assert.deepEqual(fresh.visits, []);
  await driver.perform({ id: 'later', action: 'navigate', url: origin + '/later' });
  assert.deepEqual(fresh.visits, [origin + '/later']);
});

test('file-selection failure closes all contexts and prevents further dispatch', async t => {
  const { root, path, file } = await fixture(t);
  const ctx = context(), other = context();
  const target = {
    evaluate: async fn => String(fn).includes('el.name') ? 'canary' : true,
    setInputFiles: async () => { throw Error('selection failed'); },
  };
  const p = page(ctx, target), window = page(other);
  const driver = createPlaywrightComputerDriver(p, {
    windows: { 'window-secondary': window }, uploadRoot: root,
    uploadBridge: createBoundedMultipartBridge(),
  });
  const step = { id: 'select', action: 'upload', selector: '#file', filePath: path };
  await driver.preflight(step);
  await assert.rejects(driver.perform(step), /selection failed/);
  assert.equal(file.bytes, 15);
  assert.equal(ctx.closed, true); assert.equal(other.closed, true);
  await assert.rejects(driver.perform({ id: 'later', action: 'navigate', url: origin + '/later' }), /retired/);
  assert.deepEqual(p.visits, []);
});

test('cleanup failure cannot open a replacement context', async t => {
  const { root, file } = await fixture(t);
  const ctx = { close: async () => { throw Error('close failed'); } }, p = page(ctx);
  const bridge = createBoundedMultipartBridge();
  let replacements = 0;
  const driver = createPlaywrightComputerDriver(p, { uploadBridge: bridge,
    createCleanSession: async () => { replacements++; throw Error('must not run'); },
  });
  await consume(bridge, p, file, root);
  await assert.rejects(driver.completeStep(), /close failed/);
  assert.equal(replacements, 0);
  await assert.rejects(driver.perform({ id: 'later', action: 'navigate', url: origin + '/later' }), /retired/);
});

test('selection timeout remains the primary error when context close also fails', async t => {
  const { root, path } = await fixture(t);
  const timeout = Object.assign(Error('selection timeout'), { name: 'TimeoutError' });
  const ctx = { close: async () => { throw Error('close failed'); } };
  const p = page(ctx, { evaluate: async fn => String(fn).includes('el.name') ? 'canary' : true,
    setInputFiles: async () => { throw timeout; } });
  const driver = createPlaywrightComputerDriver(p, {
    uploadRoot: root, uploadBridge: createBoundedMultipartBridge(),
  });
  const step = { id: 'timed-out', action: 'upload', selector: '#file', filePath: path };
  await driver.preflight(step);
  await assert.rejects(driver.perform(step), error => error === timeout);
  await assert.rejects(driver.endRun(), /close failed/);
  await assert.rejects(driver.perform({ id: 'later', action: 'navigate', url: origin }), /retired/);
});

test('executor closes armed contexts when consent for the submit is denied', async () => {
  let armed = false, cleaned = false, clicks = 0;
  const driver = {
    observe: async () => ({ url: origin + '/form', text: 'form' }),
    preflight: async () => true,
    approvalMetadata: () => ({ fileSha256: 'a'.repeat(64), fileBytes: 1, fileName: 'a.txt' }),
    perform: async step => { if (step.action === 'upload') armed = true; else clicks++; return { verifiedEffect: true }; },
    endRun: async () => { cleaned = armed; },
  };
  const executor = createComputerExecutor({ driver, store: createMemoryComputerStore(),
    allowedOrigins: [origin], authorize: async request => request.action === 'upload',
  });
  const result = await executor.run({ id: 'denied-submit', steps: [
    { action: 'upload', selector: '#file', filePath: '/approved/a.txt', expect: { textIncludes: 'form' } },
    { action: 'click', selector: '#submit', expect: { textIncludes: 'receipt' } },
  ] });
  assert.equal(result.status, 'approval-required');
  assert.equal(result.receipts.length, 1);
  assert.equal(clicks, 0); assert.equal(cleaned, true);
});

test('a replacement failure preserves the verified receipt without replaying the submit', async () => {
  let clicked = 0;
  const store = createMemoryComputerStore();
  const driver = {
    observe: async () => ({ url: origin + (clicked ? '/receipt' : '/form'), text: clicked ? 'receipt' : 'form' }),
    perform: async () => { clicked++; },
    completeStep: async () => { throw Error('fresh context unavailable'); },
  };
  const executor = createComputerExecutor({ driver, store, allowedOrigins: [origin], authorize: async () => true });
  const plan = { id: 'replacement-failure', steps: [
    { action: 'click', selector: '#submit', expect: { textIncludes: 'receipt' } },
  ] };
  assert.equal((await executor.run(plan)).status, 'browser-restart-required');
  const saved = await store.read(plan.id);
  assert.equal(saved.pending, null); assert.equal(saved.completed.length, 1);
  assert.equal(saved.receipts.length, 1);
  assert.equal((await executor.run(plan)).status, 'completed');
  assert.equal(clicked, 1);
});

test('failed cleanup preserves timeout diagnostics and the pending action', async () => {
  const timeout = Object.assign(Error('action timed out'), { name: 'TimeoutError' });
  const driver = {
    observe: async () => ({ url: origin + '/form', text: 'form' }),
    perform: async () => { throw timeout; },
    endRun: async () => { throw Error('close failed'); },
  };
  const executor = createComputerExecutor({ driver, store: createMemoryComputerStore(),
    allowedOrigins: [origin], authorize: async () => true });
  const result = await executor.run({ id: 'timeout-cleanup', steps: [
    { action: 'click', selector: '#submit', expect: { textIncludes: 'receipt' } },
  ] });
  assert.equal(result.status, 'reconcile-required');
  assert.equal(result.failureKind, 'browser-timeout');
  assert.equal(result.cleanupFailed, true); assert.ok(result.pending);
});

test('failed cleanup after verified completion preserves receipts and requests restart', async () => {
  let moved = false;
  const executor = createComputerExecutor({ driver: {
    observe: async () => ({ url: origin + (moved ? '/done' : '/form'), text: 'fixture' }),
    perform: async () => { moved = true; }, endRun: async () => { throw Error('close failed'); },
  }, store: createMemoryComputerStore(), allowedOrigins: [origin] });
  const result = await executor.run({ id: 'completed-cleanup', steps: [
    { action: 'navigate', url: origin + '/done', expect: { urlIncludes: '/done' } },
  ] });
  assert.equal(result.status, 'browser-restart-required');
  assert.equal(result.receipts.length, 1); assert.equal(result.cleanupFailed, true);
});

test('run and cleanup errors are both retained when observation fails', async () => {
  const primary = Error('observation failed'), cleanup = Error('cleanup failed');
  const executor = createComputerExecutor({ driver: {
    observe: async () => { throw primary; }, endRun: async () => { throw cleanup; },
  }, store: createMemoryComputerStore(), allowedOrigins: [origin] });
  await assert.rejects(executor.run({ id: 'both-failed', steps: [
    { action: 'navigate', url: origin + '/done' },
  ] }), error => error instanceof AggregateError && error.cause === primary &&
    error.errors[0] === primary && error.errors[1] === cleanup);
});
