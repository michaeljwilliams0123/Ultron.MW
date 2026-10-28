import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createComputerSessionAuthority } from '../src/computer/session-authority.mjs';
import { createPlaywrightComputerDriver } from '../src/computer/playwright-driver.mjs';
import { createComputerExecutor, createMemoryComputerStore } from '../src/computer/executor.mjs';

const origin = 'https://example.test';
const deadline = '2026-10-22T06:20:00.000Z';
const base = { sessionId: 'owner-ephemeral-1', expiresAt: deadline,
  allowedOrigins: [origin], clock: () => Date.parse('2026-10-22T06:00:00.000Z') };
const click = { action: 'click', planId: 'test', planFingerprint: 'f'.repeat(64),
  currentOrigin: origin, stepId: 'send', selector: 'button',
  expectedState: { textIncludes: 'Saved' } };

function longPageFixture(initialText) {
  let text = initialText, dispatches = 0;
  const page = {
    url: () => origin + '/receipt', title: async () => 'Owner fixture',
    goto: async () => {},
    locator: selector => selector === 'body'
      ? { innerText: async () => text }
      : { count: async () => 0, click: async options => {
        if (!options?.trial) dispatches++;
      } },
  };
  return {driver:createPlaywrightComputerDriver(page),
    setText: value => { text = value; }, get dispatches() { return dispatches; }};
}

test('Playwright observes tail confirmation and tail-only changes without persisting full text', async () => {
  const prefix = 'x'.repeat(15000), confirmation = 'Saved receipt at page tail';
  const fixture = longPageFixture(prefix + ' Before');
  const before = await fixture.driver.observe();
  fixture.setText(prefix + ' ' + confirmation);
  const tail = await fixture.driver.observe({textIncludes:confirmation});
  assert.ok(tail.text.includes(confirmation));
  assert.ok(tail.text.length <= 10000);
  const after = await fixture.driver.observe();
  assert.equal(before.text, after.text);
  assert.notEqual(before.textDigest, after.textDigest);
  assert.match(after.textDigest, /^[a-f0-9]{64}$/);
  const store = createMemoryComputerStore();
  const result = await createComputerExecutor({driver:fixture.driver,store,
    allowedOrigins:[origin]}).run({id:'tail-readback',steps:[{
      action:'observe',expect:{textIncludes:confirmation},
    }]});
  assert.equal(result.status, 'completed');
  assert.equal(result.receipts.length, 1);
  assert.equal(JSON.stringify(await store.read('tail-readback')).includes(confirmation), false);
});

test('Playwright pauses on text-only credential challenges beyond the text preview', async () => {
  const fixture = longPageFixture('z'.repeat(15000) + ' Approve sign-in with authenticator app');
  assert.equal((await fixture.driver.observe()).requiresOwnerTakeover, true);
});

test('tail confirmation already present refuses an interactive action before owner approval', async () => {
  const fixture = longPageFixture('p'.repeat(15000) + ' Already saved');
  let approvals = 0;
  const executor = createComputerExecutor({driver:fixture.driver,
    store:createMemoryComputerStore(),allowedOrigins:[origin],
    authorize:async () => { approvals++; return true; }});
  await assert.rejects(executor.run({id:'tail-precondition',steps:[{
    action:'click',selector:'#save',expect:{textIncludes:'Already saved'},
  }]}), /already satisfied/);
  assert.equal(approvals, 0);
  assert.equal(fixture.dispatches, 0);
});

test('operator approval requires an independent current owner-session check', async () => {
  let prompted = 0;
  const authority = createComputerSessionAuthority({ ...base,
    verifyOwner: async () => false,
    requestApproval: async () => { prompted++; return true; } });
  assert.equal(await authority.authorize(click), false);
  assert.equal(prompted, 0);
});
test('owner session rejects foreign origin and expires before asking for permission', async () => {
  let time = Date.parse('2026-10-22T06:00:00.000Z'), approvals = 0;
  const a = createComputerSessionAuthority({ ...base, clock: () => time,
    verifyOwner: async () => true,
    requestApproval: async () => { approvals++; return true; } });
  assert.equal(await a.authorize({ ...click, currentOrigin: 'https://other.test' }), false);
  time = Date.parse(deadline);
  assert.equal(await a.authorize(click), false);
  assert.equal(a.status, 'expired');
  assert.equal(approvals, 0);
});
test('revoking session during pending approval cannot authorize a click', async () => {
  let a;
  a = createComputerSessionAuthority({ ...base,
    verifyOwner: async () => true,
    requestApproval: async () => { a.revoke(); return true; } });
  assert.equal(await a.authorize(click), false);
  assert.equal(a.status, 'revoked');
});
test('bounded approvals never allow an extra action', async () => {
  let calls = 0;
  const a = createComputerSessionAuthority({ ...base,
    maxApprovals: 1, verifyOwner: async () => true,
    requestApproval: async () => { calls++; return true; } });
  assert.equal(await a.authorize(click), true);
  assert.equal(await a.authorize(click), false);
  assert.equal(calls, 1);
  assert.equal(a.status, 'exhausted');
});
test('session input rejects excessive lifetimes, missing trusted callbacks and weak origins', () => {
  assert.throws(() => createComputerSessionAuthority({
    ...base, expiresAt: '2026-10-22T12:00:00Z',
    verifyOwner: async () => true, requestApproval: async () => true }), /configuration/);
  assert.throws(() => createComputerSessionAuthority({
    ...base, verifyOwner: async () => true }), /configuration/);
  assert.throws(() => createComputerSessionAuthority({
    ...base, allowedOrigins: ['http://example.test'],
    verifyOwner: async () => true, requestApproval: async () => true }), /configuration/);
});
test('Playwright observation gives hashes of screenshot and accessibility tree, never bytes', async () => {
  const pixels = Buffer.from('synthetic-png-test');
  const accessibility = '- main: Form\n- button: Send';
  const body = { innerText: async () => 'Form ready',
    ariaSnapshot: async () => accessibility,
    click: async options => { assert.equal(options.trial, true); } };
  const page = { goto: async () => {}, url: () => origin,
    title: async () => 'Form', locator: () => body,
    screenshot: async () => pixels };
  const driver = createPlaywrightComputerDriver(page);
  const obs = await driver.observe();
  const hash = buf => createHash('sha256').update(buf).digest('hex');
  assert.equal(obs.screenshotDigest, hash(pixels));
  assert.equal(obs.accessibilityDigest, hash(accessibility));
  assert.equal(JSON.stringify(obs).includes('synthetic-png-test'), false);
  assert.equal(JSON.stringify(obs).includes('button: Send'), false);
  let submissions = 0;
  const store = createMemoryComputerStore();
  const executor = createComputerExecutor({ driver: {
    ...driver, perform: async () => { submissions++; },
  }, store, allowedOrigins: [origin], authorize: async () => true });
  // A URL/text/title change is still necessary to verify a click;
  // screenshot hash alone must not falsely certify an unchanged page.
  assert.equal((await executor.run({ id: 'unchanged-visual',
    steps: [{ action: 'click', selector: 'button',
      expect: { textIncludes: 'Saved' } }] })).status, 'reconcile-required');
  assert.equal(submissions, 1);
});

test('revoked owner session stops the next read-only navigation', async () => {
  const authority = createComputerSessionAuthority({ ...base,
    verifyOwner: async () => true, requestApproval: async () => true });
  let url = 'about:blank', performed = 0;
  const driver = {
    async observe() { return { url, title: 'Local', text: 'Ready' }; },
    async perform(step) {
      performed++;
      url = step.url;
      authority.revoke();
    },
  };
  const executor = createComputerExecutor({ driver,
    store: createMemoryComputerStore(), allowedOrigins: [origin],
    canContinue: authority.canContinue });
  const result = await executor.run({ id: 'stopped-after-first', steps: [
    { id: 'first', action: 'navigate', url: origin + '/first' },
    { id: 'second', action: 'navigate', url: origin + '/second' },
  ] });
  assert.equal(result.status, 'approval-required');
  assert.equal(result.stepId, 'second');
  assert.equal(result.receipts.length, 1);
  assert.equal(performed, 1);
});

test('revocation while observing prevents the first action', async () => {
  const authority = createComputerSessionAuthority({ ...base,
    verifyOwner: async () => true, requestApproval: async () => true });
  let performed = 0;
  const executor = createComputerExecutor({
    driver: {
      async observe() {
        authority.revoke();
        return { url: 'about:blank', title: '', text: '' };
      },
      async perform() { performed++; },
    },
    store: createMemoryComputerStore(), allowedOrigins: [origin],
    canContinue: authority.canContinue,
  });
  const result = await executor.run({ id: 'stopped-during-observe',
    steps: [{ action: 'navigate', url: origin + '/safe' }] });
  assert.equal(result.status, 'approval-required');
  assert.equal(performed, 0);
});

test('revocation after durable pending write cannot dispatch or replay', async () => {
  const authority = createComputerSessionAuthority({ ...base,
    verifyOwner: async () => true, requestApproval: async () => true });
  const checkpoint = createMemoryComputerStore();
  const store = {
    read: checkpoint.read,
    async write(id, next) {
      await checkpoint.write(id, next);
      if (next.pending) authority.revoke();
    },
  };
  let performed = 0;
  const executor = createComputerExecutor({
    driver: {
      async observe() { return { url: 'about:blank', title: '', text: '' }; },
      async perform() { performed++; },
    },
    store, allowedOrigins: [origin], canContinue: authority.canContinue,
  });
  const plan = { id: 'pending-session-stop',
    steps: [{ action: 'navigate', url: origin + '/safe' }] };
  const result = await executor.run(plan);
  assert.equal(result.status, 'reconcile-required');
  assert.equal((await executor.run(plan)).status, 'reconcile-required');
  assert.equal(performed, 0);
  assert.equal((await checkpoint.read(plan.id)).pending, 'step-1');
});

test('parallel requests reserve capacity before asynchronous owner verification', async () => {
  let release, verifications = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const authority = createComputerSessionAuthority({ ...base, maxApprovals: 1,
    verifyOwner: async () => { verifications++; await gate; return true; },
    requestApproval: async () => true });
  const first = authority.authorize(click);
  assert.equal(await authority.authorize({ ...click, stepId: 'another' }), false);
  release();
  assert.equal(await first, true);
  assert.equal(verifications, 1);
  assert.equal(authority.status, 'exhausted');
});
test('failed or rejected owner callback releases its pending approval slot', async () => {
  let attempts = 0;
  const authority = createComputerSessionAuthority({ ...base, maxApprovals: 1,
    verifyOwner: async () => true,
    requestApproval: async () => {
      attempts++;
      if (attempts === 1) throw Error('consent UI disconnected');
      return true;
    } });
  await assert.rejects(authority.authorize(click), /disconnected/);
  assert.equal(await authority.authorize(click), true);
  assert.equal(authority.status, 'exhausted');
});
test('two simultaneous owner requests cannot both pass a single approval cap', async () => {
  let release, started = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const authority = createComputerSessionAuthority({ ...base, maxApprovals: 1,
    verifyOwner: async () => true,
    requestApproval: async () => { started++; await gate; return true; } });
  const first = authority.authorize(click);
  await Promise.resolve();
  const second = authority.authorize({ ...click, stepId: 'parallel' });
  release();
  const accepted = await Promise.all([first, second]);
  assert.deepEqual(accepted, [true, false]);
  assert.equal(started, 1);
});

test('credential field triggers owner takeover and blocks scripted typing until removed', async () => {
  let protectedField = true, typed = 0;
  const page = {
    url: () => 'https://example.test/login',
    goto: async () => {},
    title: async () => 'Sign in',
    locator(selector) {
      if (selector === 'body') return {
        innerText: async () => protectedField ? 'Sign in' : 'Welcome',
        ariaSnapshot: async () => 'main',
      };
      return {
        count: async () => selector === 'input[type="password"]:visible' &&
          protectedField ? 1 : 0,
      };
    },
  };
  const browser = createPlaywrightComputerDriver(page);
  assert.equal((await browser.observe()).requiresOwnerTakeover, true);
  const driver = {
    observe: () => browser.observe(),
    perform: async step => { if (step.action === 'type') typed++; return {
      fieldValueVerified: true,
    }; },
  };
  const checkpoint = createMemoryComputerStore();
  const executor = createComputerExecutor({
    driver, store: checkpoint, allowedOrigins: ['https://example.test'],
    authorize: async () => true,
  });
  const plan = {
    id: 'owner-takeover-test',
    steps: [{ action: 'type', selector: '#login', value: 'not-a-password',
      expect: { textIncludes: 'Welcome' } }],
  };
  const stopped = await executor.run(plan);
  assert.equal(stopped.status, 'owner-takeover-required');
  assert.equal(typed, 0);
  // Actual sign-in must be completed by the owner in the isolated browser.
  // This toggles only a TEST fixture, not a real account.
  protectedField = false;
  assert.equal((await executor.run(plan)).status, 'completed');
  assert.equal(typed, 1);
});
test('owner takeover is conservative when one-time-code field is visible', async () => {
  const page = {
    url: () => 'https://example.test/mfa',
    goto: async () => {},
    title: async () => 'MFA',
    locator(selector) {
      if (selector === 'body') return {
        innerText: async () => 'Enter one-time code',
      };
      return { count: async () =>
        selector === 'input[autocomplete="one-time-code"]:visible' ? 1 : 0 };
    },
  };
  assert.equal((await createPlaywrightComputerDriver(page).observe())
    .requiresOwnerTakeover, true);
});
test('text-only MFA challenge pauses automation without trusting page instructions', async () => {
  const page = {
    url: () => 'https://example.test/mfa',
    goto: async () => {}, title: async () => 'Security check',
    locator(selector) {
      if (selector === 'body') return {
        innerText: async () => 'Approve sign-in with authenticator app',
      };
      return { count: async () => 0 };
    },
  };
  const observation = await createPlaywrightComputerDriver(page).observe();
  assert.equal(observation.requiresOwnerTakeover, true);
});


test('upload and download require authenticated owner approval with transfer metadata', async () => {
 const seen=[];
 const authority=createComputerSessionAuthority({...base,maxApprovals:2,
   verifyOwner:async context=>{seen.push(['verified',context.action]);return true;},
   requestApproval:async context=>{seen.push(['approved',context.action,context.fileSha256]);return true;}
 });
 const upload={...click,action:'upload',stepId:'choose-owner-file',
   selector:'input[type=file]',fileName:'approved.csv',fileSha256:'b'.repeat(64),
   fileBytes:51};
 const download={...click,action:'download',stepId:'download-report',
   selector:'#download',fileName:'report.csv'};
 assert.equal(await authority.authorize(upload),true);
 assert.equal(await authority.authorize(download),true);
 assert.equal(authority.status,'exhausted');
 assert.deepEqual(seen.map(v=>v[1]),['upload','upload','download','download']);
});

test('upload authorization rejects missing file digest, unknown origin and owner denial',async()=>{
 let attempts=0;
 const authority=createComputerSessionAuthority({...base,
   verifyOwner:async()=>true,
   requestApproval:async()=>{attempts++;return false;}
 });
 const upload={...click,action:'upload',fileName:'upload.csv',fileBytes:32};
 assert.equal(await authority.authorize(upload),false);
 assert.equal(await authority.authorize({...upload,fileSha256:'c'.repeat(64),
   currentOrigin:'https://unknown.test'}),false);
 assert.equal(attempts,0);
 assert.equal(await authority.authorize({...upload,fileSha256:'c'.repeat(64)}),false);
 assert.equal(attempts,1);
});
