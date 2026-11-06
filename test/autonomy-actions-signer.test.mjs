import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { signApprovedRequest, encryptGrant, grantRequestForMutation, SIGNING_POLICY_SHA } from '../src/autonomy/independent-signer.mjs';
import { verifySignerProtection } from '../src/autonomy/signer-protection.mjs';
import { decryptVerifiedGrant } from '../src/autonomy/grant-recipient.mjs';
import { verifyDelegatedGrant } from '../cloud/hatchable/lib/security-adjudicator.js';

const subtle = webcrypto.subtle;
const mutation = { operation: 'mcp.queue.submit', key: 'approved-123', objective: 'repo.inspect',
  expectedProfileVersion: 2, expectedStopVersion: 3 };
const request = grantRequestForMutation(mutation);
const now = Date.parse('2026-11-06T12:00:00.000Z');
const signing = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateJwk = await subtle.exportKey('jwk', signing.privateKey);
const publicJwk = await subtle.exportKey('jwk', signing.publicKey);

test('approved request produces a real grant accepted by the Hatchable verifier', async () => {
  const envelope = await signApprovedRequest({ request, mutation, privateJwk, now });
  const grant = await verifyDelegatedGrant({ envelope, publicJwk, request,
    now: new Date(now + 1000).toISOString(), subtle });
  assert.equal(grant.policySha, SIGNING_POLICY_SHA);
  assert.equal(grant.operation, request.operation);
  await assert.rejects(verifyDelegatedGrant({ envelope, publicJwk, request,
    now: new Date(now + 300000).toISOString(), subtle }), /grant-expired/);
  envelope.payload = envelope.payload.replace(request.objectiveId, 'approved-456');
  await assert.rejects(verifyDelegatedGrant({ envelope, publicJwk, request,
    now: new Date(now + 1000).toISOString(), subtle }), /invalid-grant-signature/);
});

test('signer refuses unbounded or administrative requests', async () => {
  for (const change of [
    { operation: 'permissions.change' }, { operation: 'repo.pr.squash' },
    { actor: 'worker:untrusted' }, { administrativeChange: true },
    { resource: 'https://example.com' }, { objectiveId: '../escape' }, { extra: 'x' }
  ]) await assert.rejects(signApprovedRequest({ request: { ...request, ...change }, mutation, privateJwk, now }),
    /request-rejected-by-signing-policy/);
  await assert.rejects(signApprovedRequest({ request, mutation, privateJwk: publicJwk, now }), /invalid-signing-key/);
  await assert.rejects(signApprovedRequest({ request, mutation: { ...mutation, objective: 'repo.prs' },
    privateJwk, now }), /mutation-grant-mismatch/);
  await assert.rejects(signApprovedRequest({ request, mutation: { ...mutation, objective: 'shell' },
    privateJwk, now }), /mutation-rejected-by-signing-policy/);
});

test('encrypted output is recoverable only with recipient private key', async () => {
  const recipient = await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const envelope = await signApprovedRequest({ request, mutation, privateJwk, now });
  const encrypted = await encryptGrant(envelope, await subtle.exportKey('jwk', recipient.publicKey));
  assert.equal(JSON.stringify(encrypted).includes(envelope.payload), false);
  const key = await subtle.decrypt({ name: 'RSA-OAEP' }, recipient.privateKey,
    Buffer.from(encrypted.encryptedKey, 'base64url'));
  const aes = await subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(encrypted.iv, 'base64url') },
    aes, Buffer.from(encrypted.ciphertext, 'base64url'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain)), envelope);
  const privateRecipient = await subtle.exportKey('jwk', recipient.privateKey);
  const recovered = await decryptVerifiedGrant({ encrypted, recipientPrivateJwk: privateRecipient,
    signerPublicJwk: publicJwk, mutation, now: new Date(now + 1000).toISOString() });
  assert.deepEqual(recovered.envelope, envelope);
  await assert.rejects(decryptVerifiedGrant({ encrypted, recipientPrivateJwk: privateRecipient,
    signerPublicJwk: publicJwk, mutation: { ...mutation, objective: 'repo.prs' },
    now: new Date(now + 1000).toISOString() }), /grant-scope-mismatch/);
  await assert.rejects(decryptVerifiedGrant({ encrypted, recipientPrivateJwk: privateRecipient,
    signerPublicJwk: publicJwk, mutation, now: new Date(now + 300000).toISOString() }),
    /grant-expired/);
  const corrupted = Buffer.from(encrypted.ciphertext, 'base64url');
  corrupted[0] ^= 1;
  await assert.rejects(decryptVerifiedGrant({ encrypted: { ...encrypted,
    ciphertext: corrupted.toString('base64url') }, recipientPrivateJwk: privateRecipient,
    signerPublicJwk: publicJwk, mutation, now: new Date(now + 1000).toISOString() }));
  const impostor = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  await assert.rejects(decryptVerifiedGrant({ encrypted, recipientPrivateJwk: privateRecipient,
    signerPublicJwk: await subtle.exportKey('jwk', impostor.publicKey), mutation,
    now: new Date(now + 1000).toISOString() }), /invalid-grant-signature/);
  const forged = await encryptGrant({ ...envelope, payload: envelope.payload.replace('approved-123', 'approved-456') },
    await subtle.exportKey('jwk', recipient.publicKey));
  await assert.rejects(decryptVerifiedGrant({ encrypted: forged, recipientPrivateJwk: privateRecipient,
    signerPublicJwk: publicJwk, mutation, now: new Date(now + 1000).toISOString() }),
    /invalid-grant-signature/);
  await assert.rejects(decryptVerifiedGrant({ encrypted: { ...encrypted, iv: '!' },
    recipientPrivateJwk: privateRecipient, signerPublicJwk: publicJwk, mutation }),
    /invalid-encrypted-grant/);
  await assert.rejects(encryptGrant(envelope, await subtle.exportKey('jwk', recipient.privateKey)),
    /invalid-recipient-key/);
});

test('signer reconstructs the exact Hatchable queue and control grant bindings', async () => {
  const source = await readFile(new URL('../cloud/hatchable/lib/mcp-signed-mutation.js', import.meta.url), 'utf8');
  const transformed = source
    .replace("'lib/security-adjudicator.js'", JSON.stringify(new URL('../cloud/hatchable/lib/security-adjudicator.js', import.meta.url).href))
    .replace("'lib/owner-live-events.js'", JSON.stringify(new URL('../cloud/hatchable/lib/owner-live-events.js', import.meta.url).href));
  const { prepareMutation } = await import('data:text/javascript;base64,' + Buffer.from(transformed).toString('base64'));
  globalThis.crypto ??= webcrypto;
  for (const candidate of [mutation, { operation: 'mcp.task.control', key: 'control-123',
    action: 'cancel', id: 12, expectedProfileVersion: 2, expectedStopVersion: 3 }]) {
    const prepared = await prepareMutation(candidate);
    assert.equal(prepared.ok, true);
    assert.deepEqual(grantRequestForMutation(candidate), prepared.grantRequest);
  }
});

test('signer refuses missing independent environment or branch protections', () => {
  const environment = { name: 'ultron-independent-signer',
    deployment_branch_policy: { custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: true,
      reviewers: [{ type: 'User', reviewer: { login: 'independent-reviewer' } }] }] };
  const branch = { enforce_admins: { enabled: true }, required_pull_request_reviews: {
    required_approving_review_count: 1, require_code_owner_reviews: true } };
  const policies = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
  assert.doesNotThrow(() => verifySignerProtection(environment, branch, policies));
  assert.throws(() => verifySignerProtection({}, branch, policies), /protection-unverified/);
  assert.throws(() => verifySignerProtection(environment, {
    ...branch, required_pull_request_reviews: { required_approving_review_count: 0 }
  }, policies), /protection-unverified/);
  assert.throws(() => verifySignerProtection({ ...environment, protection_rules: [
    { type: 'required_reviewers', prevent_self_review: true,
      reviewers: [{ type: 'User', reviewer: { login: 'michaeljwilliams0123' } }] }
  ] }, branch, policies), /protection-unverified/);
  assert.throws(() => verifySignerProtection({ ...environment, protection_rules: [
    { type: 'required_reviewers', prevent_self_review: true, reviewers: [
      { type: 'User', reviewer: { login: 'independent-reviewer' } },
      { type: 'Team', reviewer: { slug: 'unverified-team' } }
    ] }
  ] }, branch, policies), /protection-unverified/);
  assert.throws(() => verifySignerProtection(environment, branch, {
    total_count: 2, branch_policies: [{ name: 'main', type: 'branch' },
      { name: '*', type: 'branch' }]
  }), /protection-unverified/);
  assert.throws(() => verifySignerProtection(environment, {
    ...branch, required_pull_request_reviews: { require_code_owner_reviews: true }
  }, policies), /protection-unverified/);
});
