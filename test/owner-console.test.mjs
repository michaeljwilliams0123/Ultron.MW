import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import {
  summarizeComputerApproval, createOwnerConsoleAuthorizer,
} from '../src/computer/owner-console.mjs';

const request = () => ({
  planId: 'smoke-01',
  planFingerprint: 'a'.repeat(64),
  stepId: 'fill',
  action: 'type',
  currentOrigin: 'http://127.0.0.1:9000',
  selector: '#subject',
  valueLength: 13,
  value: 'never print me',
  expectedState: { textIncludes: 'Form' },
});

function consoleStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  input.setRawMode = () => {};
  let printed = '';
  output.on('data', chunk => { printed += chunk.toString(); });
  return { input, output, printed: () => printed };
}

test('owner approval preview discloses target and expectation but not typed content', () => {
  const preview = summarizeComputerApproval(request());
  assert.equal(preview.target, '#subject');
  assert.equal(preview.valueLength, 13);
  assert.equal(preview.expected.textIncludes, 'Form');
  assert.ok(!JSON.stringify(preview).includes('never print me'));
  assert.ok(!Object.hasOwn(preview, 'value'));
});

test('owner approval rejects missing plan fingerprint, invalid actions and missing terminal', () => {
  assert.throws(() => summarizeComputerApproval({ ...request(), planFingerprint: 'no' }),
    /Invalid owner approval/);
  assert.throws(() => summarizeComputerApproval({ ...request(), action: 'navigate' }),
    /Invalid owner approval/);
  assert.throws(() => createOwnerConsoleAuthorizer({
    input: { isTTY: false }, output: { isTTY: true },
  }), /interactive local terminal/);
  assert.throws(() => createOwnerConsoleAuthorizer({
    input: { isTTY: true }, output: { isTTY: true }, timeoutMs: 180000,
  }), /timeout/);
});

test('explicit matching challenge grants only the requested action', async () => {
  const streams = consoleStreams();
  const approve = createOwnerConsoleAuthorizer({
    ...streams, timeoutMs: 2000, makeChallenge: () => 'cafe1234',
  });
  const pending = approve(request());
  streams.input.write('APPROVE cafe1234\n');
  assert.equal(await pending, true);
  assert.match(streams.printed(), /cafe1234/);
  assert.match(streams.printed(), /#subject/);
  assert.doesNotMatch(streams.printed(), /never print me/);
  streams.input.destroy();
  streams.output.destroy();
});

test('wrong challenge never grants authority', async () => {
  const streams = consoleStreams();
  const approve = createOwnerConsoleAuthorizer({
    ...streams, timeoutMs: 2000, makeChallenge: () => 'cafe1234',
  });
  const pending = approve(request());
  streams.input.write('APPROVE wrong\n');
  assert.equal(await pending, false);
  streams.input.destroy();
  streams.output.destroy();
});

test('owner runner refuses headless GitHub Actions and piped input before launching a browser', () => {
  const run = spawnSync(process.execPath,
    ['scripts/owner-browser-run.mjs', 'does-not-exist.json'],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /interactive local terminal/);
});
