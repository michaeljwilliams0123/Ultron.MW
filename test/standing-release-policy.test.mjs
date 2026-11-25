import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  CANONICAL_COUNCIL_APP_ID,
  CANONICAL_PROJECT_ID,
  CANONICAL_REPO,
  CANONICAL_REPO_ID,
  CANONICAL_WORKFLOW_REF,
  STANDING_POLICY_SCHEMA,
  classifyChangedPaths,
  computeStandingPolicySha256,
  validateStandingPolicyShape,
} from '../cloud/hatchable/lib/standing-release-policy.js';
import { verifyGithubReleaseOidc } from '../cloud/hatchable/lib/github-oidc-release-identity.js';
import { evaluateAndAuthorizeAutonomousRelease } from '../cloud/hatchable/lib/autonomous-release-eligibility.js';
import { submitDeploymentReleaseReceipt } from '../cloud/hatchable/lib/deployment-release-receipt.js';

const now = Date.parse('2026-11-24T23:00:00Z');
const epoch = Math.floor(now / 1000);
const sha = 'e'.repeat(40);
const digest = 'sha256:' + 'f'.repeat(64);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'gh-oidc-test-1';
jwk.alg = 'RS256';
jwk.use = 'sig';

function mintOidcJwt(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'gh-oidc-test-1' })).toString('base64url');
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'ultron.release-authorizer.v1',
    repository: CANONICAL_REPO,
    repository_id: String(CANONICAL_REPO_ID),
    repository_owner: 'michaeljwilliams0123',
    repository_owner_id: '308995719',
    ref: 'refs/heads/main',
    environment: 'production-autonomous-release',
    workflow_ref: CANONICAL_WORKFLOW_REF,
    event_name: 'workflow_dispatch',
    sha,
    jti: 'jti-unique-0001',
    run_id: '9001',
    run_attempt: '1',
    iat: epoch - 10,
    exp: epoch + 290,
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

const fetchJwks = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });

const basePolicy = {
  schema: STANDING_POLICY_SCHEMA,
  policyId: 'srp-prod-20261124',
  policyVersion: 1,
  ownerCredentialId: 'cred-owner-p256-00000001',
  notBefore: '2026-11-24T00:00:00Z',
  expiresAt: '2026-12-24T00:00:00Z',
  stopVersion: 1,
  maxReleases: 20,
  repository: CANONICAL_REPO,
  repositoryId: CANONICAL_REPO_ID,
  projectId: CANONICAL_PROJECT_ID,
  environment: 'production',
  branchRef: 'refs/heads/main',
  workflowRef: CANONICAL_WORKFLOW_REF,
  councilAppId: CANONICAL_COUNCIL_APP_ID,
  maxCostUsd: 0,
};

const baseEvidence = {
  mainSha: sha,
  ciVerified: true,
  ciSha: sha,
  councilVerified: true,
  provenanceVerified: true,
  provenanceSha: sha,
  changedFiles: ['public/app.js', 'docs/README.md'],
  previousDeploymentVersion: 158,
  liveDeployment: {
    verified: true,
    target: 'hatchable-v159',
    sourceSha: sha,
    artifactDigest: digest,
    manifestFileCount: 286,
  },
};

function makeFakeDb({ policyOverrides = {}, transactionOutcome = 'recorded', jtiConflict = false } = {}) {
  const policyRow = {
    policy_id: basePolicy.policyId,
    policy_version: basePolicy.policyVersion,
    policy_sha256: computeStandingPolicySha256(basePolicy),
    stop_version: 1,
    max_releases: 20,
    releases_consumed: 0,
    max_cost_usd: 0,
    enabled: true,
    revoked_at: null,
    not_before: basePolicy.notBefore,
    expires_at: basePolicy.expiresAt,
    workflow_ref: CANONICAL_WORKFLOW_REF,
    policy_json: basePolicy,
    ...policyOverrides,
  };
  return {
    async query(sql) {
      if (sql.includes('FROM brain_standing_release_policies ORDER BY')) {
        return { rows: policyOverrides === null ? [] : [policyRow] };
      }
      if (sql.includes('WITH policy_lock AS')) {
        if (jtiConflict) return { rows: [{ outcome: 'conflict', claim_id: 7, receipt_id: 42 }] };
        if (transactionOutcome === 'denied') return { rows: [{ outcome: 'denied', claim_id: null, receipt_id: null }] };
        if (transactionOutcome === 'existing') return { rows: [{ outcome: 'existing', claim_id: 7, receipt_id: 42 }] };
        return { rows: [{ outcome: 'recorded', claim_id: 8, receipt_id: 43, releases_consumed: 1 }] };
      }
      return { rows: [] };
    },
  };
}

test('OIDC verifier accepts valid main release workflow and rejects wrong repo, workflow, env, PR, and expired JWT', async () => {
  const ok = await verifyGithubReleaseOidc({ token: mintOidcJwt(), fetchJwks, now });
  assert.equal(ok.sha, sha);
  assert.equal(ok.jti, 'jti-unique-0001');

  for (const bad of [
    { repository: 'other/Ultron.MW' },
    { repository_id: '999999' },
    { workflow_ref: 'michaeljwilliams0123/Ultron.MW/.github/workflows/other.yml@refs/heads/main' },
    { environment: 'staging' },
    { aud: 'wrong-audience' },
    { event_name: 'pull_request' },
    { event_name: 'pull_request_target' },
    { ref: 'refs/heads/feature' },
    { exp: epoch - 5 },
    { iat: epoch + 120 },
  ]) {
    await assert.rejects(verifyGithubReleaseOidc({ token: mintOidcJwt(bad), fetchJwks, now }));
  }
});

test('standing policy shape enforces zero-spend and 31-day max window', () => {
  assert.equal(validateStandingPolicyShape(basePolicy), null);
  assert.equal(validateStandingPolicyShape({ ...basePolicy, maxCostUsd: 1 }), 'zero-spend-required');
  assert.equal(validateStandingPolicyShape({ ...basePolicy, expiresAt: '2027-02-01T00:00:00Z' }), 'policy-window-invalid');
});

test('security-sensitive path changes force human-required rather than silent approval', async () => {
  const denied = [
    '.github/workflows/verify.yml',
    'cloud/hatchable/lib/standing-release-policy.js',
    'cloud/hatchable/migrations/0053_standing_release_policy.sql',
    'cloudflare/edge-shield/src/proxy.ts',
  ];
  for (const path of denied) {
    assert.equal(classifyChangedPaths([path], basePolicy).eligible, false);
    const res = await evaluateAndAuthorizeAutonomousRelease({
      db: makeFakeDb(),
      oidcIdentity: { sha, jti: 'jti-1', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 1, workflowAttempt: 1 },
      evidence: { ...baseEvidence, changedFiles: [path] },
      mode: 'authorize',
      now,
    });
    assert.equal(res.ok, false);
    assert.equal(res.decision, 'human-required');
    assert.equal(res.reason, 'security-sensitive-path-changed');
  }
});

test('evaluator denies expired, revoked, disabled, budget-exhausted, missing-gate, and rollback releases', async () => {
  const oidc = { sha, jti: 'jti-2', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 2, workflowAttempt: 1 };
  const cases = [
    { db: makeFakeDb({ policyOverrides: { revoked_at: '2026-11-24T22:00:00Z' } }), reason: 'policy-revoked' },
    { db: makeFakeDb({ policyOverrides: { enabled: false } }), reason: 'policy-disabled' },
    { db: makeFakeDb({ policyOverrides: { expires_at: '2026-11-24T22:00:00Z' } }), reason: 'policy-expired-or-not-active' },
    { db: makeFakeDb({ policyOverrides: { releases_consumed: 20 } }), reason: 'policy-release-budget-exhausted' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, councilVerified: false }, reason: 'council-not-verified' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, ciVerified: false }, reason: 'ci-not-verified' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, provenanceVerified: false }, reason: 'sigstore-provenance-not-verified' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, liveDeployment: { ...baseEvidence.liveDeployment, verified: false } }, reason: 'hatchable-manifest-not-verified' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, previousDeploymentVersion: 160 }, reason: 'rollback-requires-owner-ceremony' },
  ];
  for (const c of cases) {
    const res = await evaluateAndAuthorizeAutonomousRelease({
      db: c.db,
      oidcIdentity: oidc,
      evidence: c.evidence || baseEvidence,
      mode: 'authorize',
      now,
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, c.reason);
  }
});

test('valid release records one receipt atomically, handles idempotent retry, and rejects jti conflict or stop_version race', async () => {
  const oidc = { sha, jti: 'jti-3', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 3, workflowAttempt: 1 };
  const recorded = await evaluateAndAuthorizeAutonomousRelease({
    db: makeFakeDb(),
    oidcIdentity: oidc,
    evidence: baseEvidence,
    mode: 'authorize',
    now,
  });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.receiptId, 43);
  assert.equal(recorded.reused, false);

  const retried = await evaluateAndAuthorizeAutonomousRelease({
    db: makeFakeDb({ transactionOutcome: 'existing' }),
    oidcIdentity: oidc,
    evidence: baseEvidence,
    mode: 'authorize',
    now,
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.reused, true);
  assert.equal(retried.receiptId, 42);

  const conflict = await evaluateAndAuthorizeAutonomousRelease({
    db: makeFakeDb({ jtiConflict: true }),
    oidcIdentity: oidc,
    evidence: baseEvidence,
    mode: 'authorize',
    now,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'oidc-jti-or-tuple-conflict');

  const stopRace = await evaluateAndAuthorizeAutonomousRelease({
    db: makeFakeDb({ transactionOutcome: 'denied' }),
    oidcIdentity: oidc,
    evidence: baseEvidence,
    mode: 'authorize',
    now,
  });
  assert.equal(stopRace.ok, false);
  assert.equal(stopRace.reason, 'standing-policy-transaction-denied');
});

test('submitDeploymentReleaseReceipt accepts standing-policy-v1 only with matching verified authorization', async () => {
  const denied = await submitDeploymentReleaseReceipt({
    db: { query: async () => ({ rows: [] }) },
    config: { get: async () => '{}' },
    request: { target: 'hatchable-v159', sourceSha: sha, artifactDigest: digest, manifestFileCount: 286 },
    authorizationType: 'standing-policy-v1',
    standingAuthorization: { ok: false, decision: 'denied' },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'standing-authorization-invalid');
});
