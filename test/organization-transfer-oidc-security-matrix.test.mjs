import test from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  councilOidcAudience,
  councilRoomExecutionOidcAudience,
  verifyCouncilOidc,
  verifyCouncilWorkerOidc,
  verifyCouncilRoomExecutionOidc
} from '../cloud/hatchable/lib/council-oidc.js';
import { oidcAudience, verifyGitHubOidc } from '../cloud/hatchable/lib/github-oidc-bridge.js';

const REPO = 'Ultron-MW/Ultron.MW';
const SUBJECT = 'repo:Ultron-MW@354776009/Ultron.MW@1424939667:ref:refs/heads/main';
const REF = 'refs/heads/main';
const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-11-10T12:00:00Z');
const OWNER = { actor: 'michaeljwilliams0123', actor_id: '308995719' };
const ULTRON = { actor: 'michaeljwilliams0123ultron', actor_id: '354634860' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'org-transfer-contract-key', alg: 'RS256', use: 'sig' };
const encoded = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function signed(claims) {
  const payload = encoded({ typ: 'JWT', alg: 'RS256', kid: key.kid }) + '.' + encoded(claims);
  const signer = createSign('RSA-SHA256');
  signer.update(payload);
  signer.end();
  return payload + '.' + signer.sign(privateKey).toString('base64url');
}
const fetchJwks = async () => Response.json({ keys: [key] });
const shared = {
  iss: 'https://token.actions.githubusercontent.com',
  sub: SUBJECT,
  repository: REPO,
  repository_id: '1424939667',
  repository_owner: 'Ultron-MW',
  repository_owner_id: '354776009',
  repository_visibility: 'public',
  ref: REF,
  sha: SHA,
  iat: Math.floor(NOW / 1000) - 5,
  exp: Math.floor(NOW / 1000) + 125
};
const councilBody = JSON.stringify({ issueNumber: 370, action: 'plan' });
const councilClaims = (changes = {}) => ({
  ...shared,
  ...OWNER,
  aud: councilOidcAudience(councilBody),
  workflow_ref: REPO + '/.github/workflows/council-debate.yml@' + REF,
  event_name: 'issues',
  ...changes
});
const council = (changes = {}, rawBody = councilBody) =>
  verifyCouncilOidc({ token: signed(councilClaims(changes)), rawBody, fetchJwks, now: () => NOW });

for (const actor of [OWNER, ULTRON]) {
  test('Council accepts a correctly signed canonical organization identity for ' + actor.actor, async () => {
    const result = await council(actor);
    assert.equal(result.actor, actor.actor);
    assert.equal(result.sha, SHA);
    assert.equal(result.event, 'issues');
  });
}
const councilDenials = [
  ['retired repository name', { repository: 'michaeljwilliams0123/Ultron.MW' }],
  ['retired repository owner', { repository_owner: 'michaeljwilliams0123' }],
  ['wrong organization ID', { repository_owner_id: '308995719' }],
  ['wrong stable repository ID', { repository_id: '1' }],
  ['old immutable subject', { sub: 'repo:michaeljwilliams0123@308995719/Ultron.MW@1424939667:ref:' + REF }],
  ['missing actor ID', { actor_id: undefined }],
  ['mismatched owner ID', { actor_id: '354634860' }],
  ['mismatched Ultron ID', { ...ULTRON, actor_id: '308995719' }],
  ['unapproved actor', { actor: 'github-actions[bot]', actor_id: '12345' }],
  ['private repository', { repository_visibility: 'private' }],
  ['untrusted branch', { ref: 'refs/heads/untrusted' }],
  ['untrusted workflow', { workflow_ref: REPO + '/.github/workflows/payload.yml@' + REF }],
  ['untrusted event', { event_name: 'pull_request_target' }],
  ['wrong audience', { aud: 'not-the-body-hash' }],
  ['expired authorization', { exp: Math.floor(NOW / 1000) - 1 }]
];
for (const [description, mutation] of councilDenials) {
  test('Council rejects ' + description, async () => {
    await assert.rejects(council(mutation), /council-oidc-untrusted/);
  });
}
test('Council rejects a changed raw request body even with an otherwise valid signed token', async () => {
  await assert.rejects(council({}, councilBody + ' '), /council-oidc-untrusted/);
});
test('Council rejects a tampered signature', async () => {
  const good = signed(councilClaims());
  const tampered = good.slice(0, -3) + 'abc';
  await assert.rejects(
    verifyCouncilOidc({ token: tampered, rawBody: councilBody, fetchJwks, now: () => NOW }),
    /council-oidc-untrusted/
  );
});
test('Council worker permits the pinned worker workflow for Ultron but not the debate workflow', async () => {
  const claims = councilClaims({
    ...ULTRON,
    workflow_ref: REPO + '/.github/workflows/council-worker.yml@' + REF,
    event_name: 'workflow_dispatch'
  });
  const result = await verifyCouncilWorkerOidc({ token: signed(claims), rawBody: councilBody, fetchJwks, now: () => NOW });
  assert.equal(result.source, 'council-worker');
  assert.equal(result.actor, ULTRON.actor);
  await assert.rejects(
    verifyCouncilWorkerOidc({ token: signed(councilClaims()), rawBody: councilBody, fetchJwks, now: () => NOW }),
    /council-oidc-untrusted/
  );
});
test('Council room execution requires exact router and reusable workflow identities', async () => {
  const body = JSON.stringify({ phase: 'planned', issueNumber: 370 });
  const claims = councilClaims({
    ...ULTRON,
    aud: councilRoomExecutionOidcAudience(body),
    workflow_ref: REPO + '/.github/workflows/owner-comment-router.yml@' + REF,
    job_workflow_ref: REPO + '/.github/workflows/cloud-pr.yml@' + REF,
    event_name: 'issue_comment'
  });
  const opts = { rawBody: body, fetchJwks, now: () => NOW };
  const result = await verifyCouncilRoomExecutionOidc({ ...opts, token: signed(claims) });
  assert.equal(result.actor, ULTRON.actor);
  await assert.rejects(
    verifyCouncilRoomExecutionOidc({ ...opts, token: signed({ ...claims, job_workflow_ref: REPO + '/.github/workflows/verify.yml@' + REF }) }),
    /council-oidc-untrusted/
  );
});

const hfBody = JSON.stringify({
  schema: 'ultron.hf-oidc-run.v1',
  runId: 42816723356,
  runAttempt: 1,
  deliveryId: '00000000-0000-4000-8000-000000003720'
});
const hfClaims = async (changes = {}) => ({
  ...shared,
  ...OWNER,
  aud: await oidcAudience(hfBody),
  workflow_ref: REPO + '/.github/workflows/hf-oidc-bridge.yml@' + REF,
  event_name: 'workflow_dispatch',
  ...changes
});
const hfVerify = async (changes = {}, rawBody = hfBody) => verifyGitHubOidc({
  token: signed(await hfClaims(changes)), rawBody, fetchJwks, now: () => NOW
});
for (const actor of [OWNER, ULTRON]) {
  test('HF receipt ingress accepts signed ' + actor.actor + ' and preserves delivery ID', async () => {
    const result = await hfVerify(actor);
    assert.equal(result.actor, actor.actor);
    assert.equal(result.deliveryId, '00000000-0000-4000-8000-000000003720');
    assert.equal(result.runId, 42816723356);
  });
}
const hfDenials = [
  ['retired repo', { repository: 'michaeljwilliams0123/Ultron.MW' }],
  ['retired owner', { repository_owner: 'michaeljwilliams0123' }],
  ['wrong owner ID', { repository_owner_id: '308995719' }],
  ['wrong repo ID', { repository_id: '1' }],
  ['wrong actor pairing', { ...ULTRON, actor_id: '308995719' }],
  ['missing actor ID', { actor_id: undefined }],
  ['different subject', { sub: 'repo:Ultron-MW/Ultron.MW:ref:' + REF }],
  ['wrong branch', { ref: 'refs/heads/release' }],
  ['wrong workflow', { workflow_ref: REPO + '/.github/workflows/verify.yml@' + REF }],
  ['wrong audience', { aud: 'untrusted' }],
  ['expired token', { exp: Math.floor(NOW / 1000) - 1 }]
];
for (const [description, mutation] of hfDenials) {
  test('HF receipt ingress rejects ' + description, async () => {
    await assert.rejects(hfVerify(mutation), /untrusted-oidc/);
  });
}
test('HF receipt ingress rejects replay with modified body', async () => {
  await assert.rejects(hfVerify({}, hfBody + ' '), /untrusted-oidc/);
});
