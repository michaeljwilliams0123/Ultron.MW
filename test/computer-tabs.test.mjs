import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComputerPlan } from '../src/computer/executor.mjs';
import { createPlaywrightComputerDriver } from '../src/computer/playwright-driver.mjs';

const origin = 'https://example.test';
const allowedOrigins = [origin];
function fakePage(initial) {
  let url = initial;
  let closed = false;
  let focus = 0;
  return {
    url: () => url,
    title: async () => 'Title',
    goto: async next => { url = next; },
    bringToFront: async () => { focus++; },
    close: async () => { closed = true; },
    locator: () => ({
      innerText: async () => 'Test content',
      ariaSnapshot: async () => 'Test accessibility',
      count: async () => 0,
    }),
    get closed() { return closed; },
    get focus() { return focus; },
  };
}

test('tab actions are explicitly bounded by canonical origin and tab identity', () => {
  const input = { id: 'tab-check', steps: [
    { action: 'navigate', url: origin + '/main' },
    { action: 'tab-open', tabId: 'secondary', url: origin + '/two', expect: { urlIncludes: '/two' } },
    { action: 'tab-switch', tabId: 'primary', expect: { urlIncludes: '/main' } },
    { action: 'tab-close', tabId: 'secondary', expect: { urlIncludes: '/main' } },
  ] };
  const normalized = normalizeComputerPlan(input, { allowedOrigins });
  assert.equal(normalized.steps.length, 4);
  assert.throws(() => normalizeComputerPlan({ id:'bad-1', steps:[
    { action:'tab-open', tabId:'secondary', url:'https://other.test/' }
  ] }, { allowedOrigins }), /origin/);
  assert.throws(() => normalizeComputerPlan({ id:'bad-2', steps:[
    { action:'tab-open', tabId:'unbounded', url: origin }
  ] }, { allowedOrigins }), /tab/i);
});

test('browser uses only pre-authorized tabs and preserves independent URLs', async () => {
  const primary = fakePage(origin + '/main');
  const secondary = fakePage('about:blank');
  const driver = createPlaywrightComputerDriver(primary, { tabs: { primary, secondary } });
  await driver.perform({ id:'open', action:'tab-open', tabId:'secondary', url:origin+'/two' });
  assert.equal((await driver.observe()).url, origin + '/two');
  await driver.perform({ id:'back', action:'tab-switch', tabId:'primary' });
  assert.equal((await driver.observe()).url, origin + '/main');
  await driver.perform({ id:'again', action:'tab-switch', tabId:'secondary' });
  assert.equal((await driver.observe()).url, origin + '/two');
  await driver.perform({ id:'end', action:'tab-close', tabId:'secondary' });
  assert.equal((await driver.observe()).url, origin + '/main');
  assert.equal(secondary.closed, true);
  await assert.rejects(driver.perform({ action:'tab-switch', tabId:'secondary' }), /unavailable/);
});

test('browser fails closed on an unopened secondary tab and never follows arbitrary page handles', async () => {
  const primary = fakePage(origin + '/main');
  const secondary = fakePage('about:blank');
  const rogue = fakePage(origin + '/rogue');
  const driver = createPlaywrightComputerDriver(primary, { tabs: { primary, secondary } });
  await assert.rejects(driver.perform({ action:'tab-switch', tabId:'secondary' }), /unopened/);
  await assert.rejects(driver.perform({ action:'tab-open', tabId:'rogue', url:origin+'/rogue' }), /unavailable/);
  assert.equal(rogue.focus, 0);
});
