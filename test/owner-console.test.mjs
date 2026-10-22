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
  assert.equal(preview.expected.textIncludes, '[redacted]');
  assert.ok(!JSON.stringify(preview).includes('never print me'));
  const privatePreview = summarizeComputerApproval({ ...request(),
    expectedState: { textIncludes: 'never print me', urlIncludes: 'url-secret-value' },
  });
  assert.deepEqual(privatePreview.expected,
    { textIncludes: '[redacted]', urlIncludes: '[redacted]' });
  assert.doesNotMatch(JSON.stringify(privatePreview), /never print me|url-secret-value/);
  assert.ok(!Object.hasOwn(preview, 'value'));
});

test('owner approval rejects missing plan fingerprint, invalid actions and missing terminal', () => {
  assert.throws(() => summarizeComputerApproval({ ...request(), planFingerprint: 'no' }),
    /Invalid owner approval/);
  assert.throws(() => summarizeComputerApproval({ ...request(), action: 'navigate' }),
    /Invalid owner approval/);
  assert.throws(() => createOwnerConsoleAuthorizer({
    input: { isTTY: false }, output: { isTTY: true }, environment: {},
  }), /interactive local terminal/);
  assert.throws(() => createOwnerConsoleAuthorizer({
    input: { isTTY: true }, output: { isTTY: true }, environment: {},
    timeoutMs: 180000,
  }), /timeout/);
});

test('pseudo-terminal is insufficient to approve inside CI', () => {
  for (const marker of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'JENKINS_URL']) {
    assert.throws(() => createOwnerConsoleAuthorizer({
      input: { isTTY: true }, output: { isTTY: true }, environment: { [marker]: 'true' },
    }), /CI execution/);
  }
});

test('explicit matching challenge grants only the requested action', async () => {
  const streams = consoleStreams();
  const approve = createOwnerConsoleAuthorizer({
    ...streams, environment: {}, timeoutMs: 2000, makeChallenge: () => 'cafe1234',
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
    ...streams, environment: {}, timeoutMs: 2000, makeChallenge: () => 'cafe1234',
  });
  const pending = approve(request());
  streams.input.write('APPROVE wrong\n');
  assert.equal(await pending, false);
  streams.input.destroy();
  streams.output.destroy();
});

test('every owner runner refuses headless automation before launching a browser', () => {
  for (const script of ['scripts/owner-browser-run.mjs',
    'scripts/computer-runner.mjs']) {
    const run = spawnSync(process.execPath, [script, 'does-not-exist.json'], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, ULTRON_COMPUTER_ALLOWED_ORIGINS:
        '["https://example.test"]' },
    });
    assert.equal(run.status, 1, script);
    assert.match(run.stderr,
      /interactive local terminal|refuses CI execution/, script);
  }
});