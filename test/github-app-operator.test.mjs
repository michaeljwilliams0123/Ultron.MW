import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createGitHubAppJwt, createGitHubAppOperator } from '../src/computer/github-app-operator.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ID = 1424939667, REPO = 'michaeljwilliams0123/Ultron.MW';
const now = 1792690000000;
const permissions = { contents: 'write', pull_requests: 'write', administration: 'read' };
const success = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => structuredClone(data),
});
const tokenResponse = (token = 'ghs_test_scoped_only_dummy_0123456789', overrides = {}) =>
  success({ token, expires_at: new Date(now + 3600000).toISOString(),
    repositories: [{ id: ID, full_name: REPO }], permissions, ...overrides });
function harness({ mutate = () => {}, first401 = false } = {}) {
  const calls = []; let issued = 0; let apiCalls = 0;
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/access_tokens')) {
      issued++;
      const response = tokenResponse('ghs_dummy_issued_value_' + issued + '_0123456789');
      mutate(response, 'exchange');
      return response;
    }
    apiCalls++;
    if (first401 && apiCalls === 1) return success(null, 401);
    return success({ id: ID, full_name: REPO, observed: true });
  };
  const auth = createGitHubAppOperator({
    clientId: 'Iv1_test_app', installationId: 83, repositoryId: ID, repository: REPO,
    permissions, loadPrivateKey: async () => keys.privateKey,
    transport, clock: () => now,
  });
  return { auth, calls, counters: () => ({ issued, apiCalls }) };
}
test('RS256 GitHub App signature matches public key and issuance bounds', () => {
  const jwt = createGitHubAppJwt({ clientId: 'Iv1_test_app',
    privateKey: keys.privateKey, now });
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(claims.iss, 'Iv1_test_app');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(parts[0] + '.' + parts[1]);
  verifier.end();
  assert.equal(verifier.verify(keys.publicKey, Buffer.from(parts[2], 'base64url')), true);
  assert.throws(() => createGitHubAppJwt({ clientId: 'bad', privateKey: 'not-a-key', now }));
});
test('installation token is confined to one repo and returns no secret to user', async () => {
  const { auth, calls } = harness();
  assert.equal(auth.status().credentialsAvailable, false);
  const result = await auth.request({ method: 'GET', path: '/', permission: 'contents:read' });
  assert.equal(result.id, ID);
  assert.equal(calls[1].url, 'https://api.github.com/repos/' + REPO);
  assert.equal(calls[0].url, 'https://api.github.com/app/installations/83/access_tokens');
  assert.deepEqual(JSON.parse(calls[0].options.body).repository_ids, [ID]);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(auth.status().credentialsAvailable, true);
  assert.equal(auth.status().tokenExposed, false);
  assert.ok(!JSON.stringify(auth.status()).includes('ghs_dummy'));
});
test('cached token reused then invalidate causes fresh exchange', async () => {
  const { auth, counters } = harness();
  await auth.request({ path: '/', permission: 'contents:read' });
  await auth.request({ path: '/pulls/72', permission: 'pull_requests:read' });
  assert.equal(counters().issued, 1);
  auth.invalidate();
  await auth.request({ path: '/', permission: 'contents:read' });
  assert.equal(counters().issued, 2);
});
test('simultaneous callers perform only one token exchange', async () => {
  const { auth, counters } = harness();
  await Promise.all(Array.from({ length: 8 }, () =>
    auth.request({ path: '/pulls/72', permission: 'pull_requests:read' })));
  assert.equal(counters().issued, 1);
  assert.equal(counters().apiCalls, 8);
});
test('repository escape, encoded path and foreign URL are refused before transport', async () => {
  const { auth, calls } = harness();
  for (const path of ['/../../other/repos', '/%2e%2e/repos', '/%2fadmin',
    'https://evil.example/', '/issues//123', '/hello#fragment', '/foo\\bar']) {
    await assert.rejects(() => auth.request({ path, permission: 'contents:read' }));
  }
  assert.equal(calls.length, 0);
});
test('mutation requires explicit matching installation permission', async () => {
  const { auth, calls } = harness();
  await assert.rejects(() => auth.request({
    method: 'DELETE', path: '/branches/main', permission: 'administration:write',
    body: {},
  }), /exceeds installed grant/);
  await assert.rejects(() => auth.request({
    method: 'POST', path: '/issues', permission: 'issues:write', body: {},
  }), /exceeds installed grant/);
  assert.equal(calls.filter(c => c.options.method === 'DELETE').length, 0);
});
test('allowed write uses token but refuses replay after 401', async () => {
  const { auth, calls } = harness({ first401: true });
  await assert.rejects(() => auth.request({ method: 'POST', path: '/issues',
    permission: 'contents:write', body: { title: 'test' } }), /reconcile before retry/);
  assert.equal(calls.filter(c => c.options.method === 'POST' &&
    c.url.includes('/repos/')).length, 1);
});
test('GET may refresh once after a 401 response', async () => {
  const { auth, counters } = harness({ first401: true });
  const observed = await auth.request({ path: '/', permission: 'contents:read' });
  assert.equal(observed.id, ID);
  assert.deepEqual(counters(), { issued: 2, apiCalls: 2 });
});
test('reject wrong installation repository identity and inadequate permissions', async () => {
  for (const override of [{ repositories: [{ id: 9, full_name: REPO }] },
    { permissions: { ...permissions, contents: 'read' } },
    { repositories: [] },
    { expires_at: new Date(now - 360000).toISOString() }]) {
    const { auth } = harness({ mutate: response => Object.assign(
      // The fake response body is provided through its json() callback.
      response, { json: async () => ({ token: 'ghs_test_scoped_only_dummy_0123456789', expires_at: new Date(now + 3600000).toISOString(), repositories: [{ id: ID, full_name: REPO }], permissions, ...override }) }) });
    // This test's wrapper intentionally rejects a malformed token response.
    await assert.rejects(() => auth.request({ permission: 'contents:read' }));
  }
});
test('owner identity, installation ID and explicit permissions are required', () => {
  assert.throws(() => createGitHubAppOperator({ repository: REPO,
    installationId: 0, repositoryId: ID, permissions,
    loadPrivateKey: async () => keys.privateKey }));
  assert.throws(() => createGitHubAppOperator({ repository: 'other/repo',
    installationId: 83, repositoryId: ID, permissions: {},
    loadPrivateKey: async () => keys.privateKey }));
  assert.throws(() => createGitHubAppOperator({ repository: REPO,
    installationId: 83, repositoryId: ID, permissions: { contents: 'admin' },
    loadPrivateKey: async () => keys.privateKey }));
});
test('no write is attempted on preflight GET or while provider admission fails', async () => {
  const { auth, calls } = harness({ mutate: response =>
    Object.assign(response, { status: 403, ok: false }) });
  await assert.rejects(() => auth.request({ method: 'POST', path: '/issues',
    permission: 'contents:write', body: {} }), /admission denied/);
  assert.equal(calls.length, 1);
});
