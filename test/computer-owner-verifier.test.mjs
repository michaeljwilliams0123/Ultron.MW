import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubCliOwnerVerifier } from '../src/computer/github-owner-verifier.mjs';

test('real GitHub CLI account check compares explicit exact owner and never handles a token', async () => {
  let invoked;
  const run = async (bin, args, options) => {
    invoked = { bin, args, options };
    return { stdout: 'michaeljwilliams0123\n' };
  };
  const verifier = createGitHubCliOwnerVerifier({
    ownerLogin: 'michaeljwilliams0123', run,
  });
  assert.equal(await verifier(), true);
  assert.equal(invoked.bin, 'gh');
  assert.deepEqual(invoked.args, [
    'api', '--hostname', 'github.com', '--method', 'GET',
    '/user', '--jq', '.login',
  ]);
  assert.equal(invoked.options.maxBuffer, 2048);
  assert.equal(invoked.args.includes('--show-token'), false);
});
test('GitHub CLI credential mismatch, failure or unconfigured owner never admits actions', async () => {
  assert.throws(() => createGitHubCliOwnerVerifier(), /Explicit/);
  assert.throws(() => createGitHubCliOwnerVerifier({
    ownerLogin: 'bad/name', run: async () => ({ stdout: 'bad/name' }),
  }), /Explicit/);
  assert.equal(await createGitHubCliOwnerVerifier({
    ownerLogin: 'michaeljwilliams0123',
    run: async () => ({ stdout: 'impostor' }),
  })(), false);
  assert.equal(await createGitHubCliOwnerVerifier({
    ownerLogin: 'michaeljwilliams0123',
    run: async () => { throw Error('unauthenticated'); },
  })(), false);
});
