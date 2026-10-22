/**
 * Opt-in, REAL Chrome + Playwright fixture acceptance. This deliberately
 * uses a SYNTHETIC owner callback and localhost apps, never external accounts.
 *
 * Prerequisites in an isolated checkout:
 *   npm install --no-save --package-lock=false --ignore-scripts playwright
 *   node scripts/computer-browser-acceptance.mjs --synthetic
 *
 * It does not deploy, log in to websites, or claim authenticated owner proof.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchIsolatedBrowser } from '../src/computer/playwright-driver.mjs';
import { createComputerExecutor } from '../src/computer/executor.mjs';
import { createFileComputerStore } from '../src/computer/file-store.mjs';
import { createComputerSessionAuthority } from '../src/computer/session-authority.mjs';

if (process.argv.slice(2).join(' ') !== '--synthetic')
  throw Error('Explicit --synthetic required: this is NOT authenticated-owner acceptance');

const html = text => '<!doctype html><html><head><title>Isolated fixture</title></head><body>' +
  text + '</body></html>';
const servers = [];
async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return 'http://127.0.0.1:' + server.address().port;
}
const closeServers = async () => {
  await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
};
let runCount = 0, foreignHits = 0, latest = '', browser, disconnectedBrowser;
const dir = await mkdtemp(join(tmpdir(), 'ultron-chrome-acceptance-'));
try {
  const foreignOrigin = await listen((_req, res) => {
    foreignHits++;
    res.end('FOREIGN SHOULD NOT BE REACHED');
  });
  const firstOrigin = await listen(async (req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: foreignOrigin + '/outside' });
      res.end();
    } else if (req.url === '/same-origin-redirect') {
      // Even an allowed first hop could redirect to a forbidden next hop.
      res.writeHead(302, { Location: '/redirect' });
      res.end();
    } else if (req.url === '/form') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html('<main>Form ready<form method="post" action="/submit">' +
        '<input id="value" name="value" aria-label="Fixture value" />' +
        '<button id="save" type="submit">Save</button></form></main>'));
    } else if (req.url === '/submit' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2048) throw Error('Unexpected fixture payload');
      }
      latest = new URLSearchParams(raw).get('value') || '';
      runCount++;
      // Deliberately return 200: this fail-closed browser worker currently
      // rejects all HTTP redirects pending a fully redirect-aware network gate.
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html('<main>Saved: ' + latest + '</main>'));
    } else if (req.url === '/receipt') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html('<main>Saved: ' + latest + '</main>'));
    } else if (req.url === '/state') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html('<main>Persisted: ' + latest + '</main>'));
    } else {
      res.writeHead(404).end();
    }
  });
  const secondOrigin = await listen((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html('<main>Second origin confirmed</main>'));
  });
  const allowedOrigins = [firstOrigin, secondOrigin];
  browser = await launchIsolatedBrowser({
    headless: true, channel: 'chrome', allowedOrigins,
  });
  const session = createComputerSessionAuthority({
    sessionId: 'synthetic-test-only',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    allowedOrigins, maxApprovals: 5,
    verifyOwner: async () => true,       // SYNTHETIC ONLY, not authentication
    requestApproval: async () => true,   // SYNTHETIC ONLY, no user consent
  });
  const store = createFileComputerStore(join(dir, 'checkpoints'));
  const executor = createComputerExecutor({
    driver: browser.driver, store,
    authorize: session.authorize, canContinue: session.canContinue, allowedOrigins,
  });
  const plan = {
    id: 'synthetic-browser-primary',
    steps: [
      { id: 'form', action: 'navigate', url: firstOrigin + '/form',
        expect: { textIncludes: 'Form ready' } },
      { id: 'fill', action: 'type', selector: '#value', value: 'ultron-fixture',
        expect: { textIncludes: 'Form ready' } },
      { id: 'save', action: 'click', selector: '#save',
        expect: { textIncludes: 'Saved: ultron-fixture' } },
      { id: 'verify', action: 'navigate', url: firstOrigin + '/state',
        expect: { textIncludes: 'Persisted: ultron-fixture' } },
      { id: 'second-origin', action: 'navigate', url: secondOrigin + '/second',
        expect: { textIncludes: 'Second origin confirmed' } },
      { id: 'fresh-readback', action: 'navigate', url: firstOrigin + '/state',
        expect: { textIncludes: 'Persisted: ultron-fixture' } },
    ],
  };
  const first = await executor.run(plan);
  assert.equal(first.status, 'completed', JSON.stringify(first));
  assert.equal(first.receipts.length, plan.steps.length);
  assert.equal(runCount, 1);
  assert(first.receipts.every(r => /^[a-f0-9]{64}$/.test(r.visualDigest)));
  assert(first.receipts.every(r => /^[a-f0-9]{64}$/.test(r.accessibilityDigest)));
  const resumed = await executor.run(plan);
  assert.equal(resumed.resumed, true);
  assert.equal(runCount, 1);
  const runCountAfterResume = runCount;
  session.revoke();
  assert.equal(await session.authorize({ action: 'click', currentOrigin: firstOrigin }), false);

  // Navigation is allowed to the first origin but its HTTP redirect to a
  // third, unauthorized origin must be stopped by actual Chromium interception.
  try { await browser.page.goto(firstOrigin + '/redirect'); }
  catch { /* Some Chromium versions throw on a blocked redirect. */ }
  assert.equal(foreignHits, 0);
  assert.notEqual(new URL(browser.page.url()).origin, foreignOrigin);
  // A same-origin first Location must also fail closed, because Chromium will
  // not re-run the route handler for the next redirect.
  try { await browser.page.goto(firstOrigin + '/same-origin-redirect'); }
  catch { /* Request is intentionally denied. */ }
  assert.equal(foreignHits, 0);
  assert.notEqual(new URL(browser.page.url()).origin, foreignOrigin);

  // A real click may happen before a browser disconnect. Retrying must return
  // reconcile-required without executing the write again.
  disconnectedBrowser = await launchIsolatedBrowser({
    headless: true, channel: 'chrome', allowedOrigins,
  });
  const driver = {
    observe: () => disconnectedBrowser.driver.observe(),
    async perform(step) {
      const result = await disconnectedBrowser.driver.perform(step);
      if (step.action === 'click') await disconnectedBrowser.page.close();
      return result;
    },
  };
  const disconnectExecutor = createComputerExecutor({
    driver, store: createFileComputerStore(join(dir, 'disconnect')),
    allowedOrigins, authorize: async () => true, // SYNTHETIC ONLY
  });
  const disconnectPlan = { id: 'synthetic-disconnect-on-write', steps: [
    { id: 'open', action: 'navigate', url: firstOrigin + '/form' },
    { id: 'fill', action: 'type', selector: '#value', value: 'disconnect-fixture',
      expect: { textIncludes: 'Form ready' } },
    { id: 'write', action: 'click', selector: '#save',
      expect: { textIncludes: 'Saved: disconnect-fixture' } },
  ] };
  const ambiguous = await disconnectExecutor.run(disconnectPlan);
  assert.equal(ambiguous.status, 'reconcile-required');
  assert.equal(ambiguous.pending, 'write');
  assert.equal(runCount, 2);
  const second = await disconnectExecutor.run(disconnectPlan);
  assert.equal(second.status, 'reconcile-required');
  assert.equal(runCount, 2);
  process.stdout.write(JSON.stringify({
    kind: 'SYNTHETIC_LOCAL_BROWSER_NOT_OWNER_AUTHENTICATED',
    status: 'passed', completedSteps: first.receipts.length,
    screenshotDigests: first.receipts.length,
    accessibilityDigests: first.receipts.length,
    resumeNoDuplicate: resumed.resumed === true && runCountAfterResume === 1,
    persistedReadback: true, interceptedForeignRedirect: foreignHits === 0,
    disconnectOutcome: ambiguous.status, noBlindReplay: runCount === 2,
  }, null, 2) + '\n');
} finally {
  await Promise.allSettled([browser?.close(), disconnectedBrowser?.close()]);
  await closeServers();
  await rm(dir, { recursive: true, force: true });
}
