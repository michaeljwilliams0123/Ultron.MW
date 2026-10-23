#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createComputerExecutor, createMemoryComputerStore } from '../src/computer/executor.mjs';
import { launchIsolatedBrowser } from '../src/computer/playwright-driver.mjs';

// Never point the injected synthetic approver at an external website/account.
if (process.argv.length !== 3 || process.argv[2] !== '--synthetic')
  throw Error('Local isolated synthetic Chrome fixture requires --synthetic');

let downloadRequests = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/download') {
    downloadRequests++;
    response.setHeader('Content-Type', 'text/plain');
    response.setHeader('Content-Disposition', 'attachment; filename="synthetic-server.txt"');
    response.end('synthetic download payload');
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/main') {
    response.end('<!doctype html><title>Primary</title><h1>Primary fixture</h1>');
  } else if (url.pathname === '/two') {
    response.end('<!doctype html><title>Secondary</title><h1>Secondary fixture</h1>');
  } else if (url.pathname === '/files') {
    response.end('<!doctype html><title>Files</title><h1>Transfer fixture</h1>' +
      '<input id="upload" type="file"><div id="selected">Not selected</div>' +
      '<a id="download" href="/download">Download sample</a>' +
      '<script>document.querySelector("#upload").addEventListener("change",e => {' +
      'document.querySelector("#selected").textContent="Selected "+e.target.files[0].name;' +
      '})</script>');
  } else {
    response.statusCode = 404;
    response.end('Not found');
  }
});
const root = await mkdtemp(join(tmpdir(), 'ultron-real-chrome-'));
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const uploadRoot = join(root, 'approved');
  const downloadRoot = join(root, 'downloads');
  await mkdir(uploadRoot); await mkdir(downloadRoot);
  const upload = join(uploadRoot, 'synthetic.csv');
  await writeFile(upload, 'col,value\na,123\n');
  browser = await launchIsolatedBrowser({
    headless: true, channel: 'chrome', allowedOrigins: [origin],
    enableTabs: true, uploadRoot, downloadRoot,
  });
  const plan = { id: 'synthetic-file-window-20261022', steps: [
    { action: 'navigate', url: origin + '/main',
      expect: { textIncludes: 'Primary fixture' } },
    { action: 'tab-open', tabId: 'secondary', url: origin + '/two',
      expect: { textIncludes: 'Secondary fixture' } },
    { action: 'tab-switch', tabId: 'primary',
      expect: { textIncludes: 'Primary fixture' } },
    { action: 'tab-switch', tabId: 'secondary',
      expect: { textIncludes: 'Secondary fixture' } },
    { action: 'navigate', url: origin + '/files',
      expect: { textIncludes: 'Transfer fixture' } },
    { action: 'upload', selector: '#upload', filePath: upload,
      expect: { textIncludes: 'Selected synthetic.csv' } },
    { action: 'download', selector: '#download', outputName: 'download-result.txt',
      expect: { textIncludes: 'Selected synthetic.csv' } },
    { action: 'tab-close', tabId: 'secondary',
      expect: { textIncludes: 'Primary fixture' } },
  ] };
  const store = createMemoryComputerStore();
  const executor = createComputerExecutor({
    driver: browser.driver, store, allowedOrigins: [origin],
    // This override is permitted ONLY on the local ephemeral fixture.
    authorize: async () => true,
  });
  const result = await executor.run(plan);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.equal(result.receipts.length, plan.steps.length);
  assert.equal(result.receipts.filter(r => r.visualDigest?.length === 64).length,
    plan.steps.length);
  assert.equal((await readFile(join(downloadRoot, 'download-result.txt'))).toString(),
    'synthetic download payload');
  assert.equal(downloadRequests, 1);
  const replay = await executor.run(plan);
  assert.equal(replay.resumed, true);
  assert.equal(downloadRequests, 1);
  // Unsolicited popups are never added as runnable authority surfaces.
  await browser.page.evaluate(() => window.open('/two', '_blank'));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(browser.page.context().pages().length, 2);
  process.stdout.write(JSON.stringify({
    type:'synthetic-real-chrome', status: result.status,
    receiptCount:result.receipts.length, oneDownload:downloadRequests===1,
    replaySuppressed:replay.resumed, popupIsolated:true, externalAccountUsed:false,
  }) + '\n');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
