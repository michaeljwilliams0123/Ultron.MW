import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import {
  STANDING_RECEIPT_GRANT_OPERATION,
  evaluateAndAuthorizeAutonomousRelease,
} from '../cloud/hatchable/lib/autonomous-release-eligibility.js';
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
  enabled: true,
};

const baseEvidence = {
  mainSha: sha,
  ciVerified: true,
  ciSha: sha,
  councilVerified: true,
  provenanceVerified: true,
  provenanceSha: sha,
  changedFilesAvailable: true,
  changedFilesTruncated: false,
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

function makeFakeDb({ policyOverrides = {}, runtimeAuthority = {stop_version:1, paused:false, credential_id:basePolicy.ownerCredentialId}, transactionOutcome = 'recorded', jtiConflict = false, queries = [] } = {}) {
  const policyRow = {
    policy_id: basePolicy.policyId,
    policy_version: basePolicy.policyVersion,
    owner_credential_id: basePolicy.ownerCredentialId,
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
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM brain_standing_release_policies ORDER BY')) {
        return { rows: policyOverrides === null ? [] : [policyRow] };
      }
      if (sql.startsWith('SELECT c.version AS stop_version')) {
        return { rows: runtimeAuthority ? [runtimeAuthority] : [] };
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

test('P0-1: security-sensitive path changes force human-required and missing/truncated changedFiles fail closed', async () => {
  const routeSrc = readFileSync(new URL('../cloud/hatchable/api/brain/deployment-release-authorize.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routeSrc, /req\.body\??\.changedFiles/);
  assert.match(routeSrc, /\/compare\//);

  const oidc = { sha, jti: 'jti-1', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 1, workflowAttempt: 1 };
  for (const badDiff of [
    { changedFilesAvailable: false },
    { changedFilesTruncated: true },
    { changedFiles: null },
  ]) {
    const res = await evaluateAndAuthorizeAutonomousRelease({
      db: makeFakeDb(),
      oidcIdentity: oidc,
      evidence: { ...baseEvidence, ...badDiff },
      mode: 'authorize',
      now,
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'changed-files-inventory-unavailable');
  }

  const denied = [
    '.github/workflows/verify.yml',
    'cloud/hatchable/lib/standing-release-policy.js',
    'cloud/hatchable/migrations/0054_standing_release_policy.sql',
    'cloudflare/edge-shield/src/proxy.ts',
  ];
  for (const path of denied) {
    assert.equal(classifyChangedPaths([path], basePolicy).eligible, false);
    const res = await evaluateAndAuthorizeAutonomousRelease({
      db: makeFakeDb(),
      oidcIdentity: oidc,
      evidence: { ...baseEvidence, changedFiles: [path] },
      mode: 'authorize',
      now,
    });
    assert.equal(res.ok, false);
    assert.equal(res.decision, 'human-required');
    assert.equal(res.reason, 'security-sensitive-path-changed');
  }
});

test('P0-2: missing previousDeploymentVersion fails closed and rollbacks require owner ceremony', async () => {
  const oidc = { sha, jti: 'jti-2', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 2, workflowAttempt: 1 };
  const missingPrev = await evaluateAndAuthorizeAutonomousRelease({
    db: makeFakeDb(),
    oidcIdentity: oidc,
    evidence: { ...baseEvidence, previousDeploymentVersion: null },
    mode: 'authorize',
    now,
  });
  assert.equal(missingPrev.ok, false);
  assert.equal(missingPrev.reason, 'previous-deployment-version-unavailable');

  const rollback = await evaluateAndAuthorizeAutonomousRelease({
    db: makeFakeDb(),
    oidcIdentity: oidc,
    evidence: { ...baseEvidence, previousDeploymentVersion: 160 },
    mode: 'authorize',
    now,
  });
  assert.equal(rollback.ok, false);
  assert.equal(rollback.decision, 'human-required');
  assert.equal(rollback.reason, 'rollback-requires-owner-ceremony');
});

test('P0-3: standing receipt grant uses cloud.release-receipt.record, never cloud.deploy', async () => {
  assert.equal(STANDING_RECEIPT_GRANT_OPERATION, 'cloud.release-receipt.record');
  const queries = [];
  const oidc = { sha, jti: 'jti-p03', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 30, workflowAttempt: 1 };
  const res = await evaluateAndAuthorizeAutonomousRelease({
    db: makeFakeDb({ queries }),
    oidcIdentity: oidc,
    evidence: baseEvidence,
    mode: 'authorize',
    now,
  });
  assert.equal(res.ok, true);
  const txQuery = queries.find(q => q.sql.includes('WITH policy_lock AS'));
  assert.ok(txQuery);
  assert.match(txQuery.sql, /cloud\.release-receipt\.record/);
  assert.doesNotMatch(txQuery.sql, /'cloud\.deploy'/);
});

test('evaluator denies expired, revoked, disabled, budget-exhausted, and missing-gate releases', async () => {
  const oidc = { sha, jti: 'jti-2b', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 2, workflowAttempt: 1 };
  const cases = [
    { db: makeFakeDb({ policyOverrides: { revoked_at: '2026-11-24T22:00:00Z' } }), reason: 'policy-revoked' },
    { db: makeFakeDb({ policyOverrides: { enabled: false } }), reason: 'policy-disabled' },
    { db: makeFakeDb({ policyOverrides: { expires_at: '2026-11-24T22:00:00Z' } }), reason: 'policy-expired-or-not-active' },
    { db: makeFakeDb({ policyOverrides: { releases_consumed: 20 } }), reason: 'policy-release-budget-exhausted' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, councilVerified: false }, reason: 'council-not-verified' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, ciVerified: false }, reason: 'ci-not-verified' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, provenanceVerified: false }, reason: 'sigstore-provenance-not-verified' },
    { db: makeFakeDb(), evidence: { ...baseEvidence, liveDeployment: { ...baseEvidence.liveDeployment, verified: false } }, reason: 'hatchable-manifest-not-verified' },
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
    request: {
      key: `hatchable-v159-${sha.slice(0, 8)}`,
      target: 'hatchable-v159',
      sourceSha: sha,
      artifactDigest: digest,
      manifestFileCount: 286,
      independentReadback: true,
    },
    authorizationType: 'standing-policy-v1',
    standingAuthorization: { ok: false, decision: 'denied' },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'standing-authorization-invalid');
});

test('OIDC event allowlist admits both recovery triggers and rejects other event types',async()=>{
 for(const event_name of ['workflow_dispatch','workflow_run','schedule']){
  const result=await verifyGithubReleaseOidc({token:mintOidcJwt({event_name}),fetchJwks,now});
  assert.equal(result.sha,sha);
 }
 for(const event_name of ['push','repository_dispatch','issue_comment','pull_request','pull_request_target']){
  await assert.rejects(verifyGithubReleaseOidc({token:mintOidcJwt({event_name}),fetchJwks,now}));
 }
});

test('hybrid security boundaries remain owner-required even with a narrower custom deny list',()=>{
 for(const file of ['cloudflare/edge-shield/src/release-authorization.ts','cloud/hatchable/api/brain/release-authorization-wakeup.js','cloud/hatchable/lib/autonomous-release-manifest.js','cloud/hatchable/lib/release-proof-readback.js']){
  assert.equal(classifyChangedPaths([file],{...basePolicy,deniedPaths:['private/**']}).eligible,false);
 }
});

test('standing enrollment accepts a real 32-byte WebAuthn challenge encoded as base64url', async () => {
  const { enrollStandingPolicy } = await import('../cloud/hatchable/lib/standing-release-policy.js');
  const { createHash } = await import('node:crypto');
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = Buffer.from('test-only-standing-policy-credential').toString('base64url');
  const policy = { ...basePolicy, ownerCredentialId: credentialId, enabled: true };
  const challenge = Buffer.from(computeStandingPolicySha256(policy), 'hex').toString('base64url');
  const client = Buffer.from(JSON.stringify({ type:'webauthn.get', challenge, origin:'https://ultron-mw-cloud.hatchable.site', crossOrigin:false }));
  const auth = Buffer.alloc(37);
  createHash('sha256').update('ultron-mw-cloud.hatchable.site').digest().copy(auth);
  auth[32] = 5;
  const signature = sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), pair.privateKey);
  const proof = { credentialId, authenticatorData:auth.toString('base64url'), clientDataJSON:client.toString('base64url'), signature:signature.toString('base64url') };
  const db = { async query(sql) {
    if (sql.includes('FROM brain_owner_passkeys')) return { rows:[{ credential_id:credentialId, public_key_spki:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url'), revoked_at:null }] };
    if (sql.includes('INSERT INTO brain_standing_release_policies')) return { rows:[{ policy_id:policy.policyId, enabled:true }] };
    throw Error('Unexpected query');
  }};
  assert.notEqual(computeStandingPolicySha256(policy), computeStandingPolicySha256({...policy, enabled:false}));
  const mismatch = await enrollStandingPolicy({db,policy,passkeyProof:proof,enabled:false,now});
  assert.deepEqual(mismatch,{ok:false,reason:'signed-enabled-state-mismatch'});
  const tampered = await enrollStandingPolicy({db,policy:{...policy,enabled:false},passkeyProof:proof,enabled:false,now});
  assert.deepEqual(tampered,{ok:false,reason:'owner-passkey-signature-invalid'});
  const result = await enrollStandingPolicy({db,policy,passkeyProof:proof,enabled:true,now});
  assert.equal(result.ok,true,result.reason);
});

test('autonomous receipt fails closed for paused runtime, changed stop version, or revoked owner credential', async () => {
  const oidc = { sha, jti: 'jti-stop-fence', workflowRef: CANONICAL_WORKFLOW_REF, workflowRunId: 1, workflowAttempt: 1 };
  for (const runtimeAuthority of [
    {stop_version:1, paused:true, credential_id:basePolicy.ownerCredentialId},
    {stop_version:2, paused:false, credential_id:basePolicy.ownerCredentialId},
    null,
  ]) {
    const queries=[];
    const result=await evaluateAndAuthorizeAutonomousRelease({db:makeFakeDb({runtimeAuthority,queries}),oidcIdentity:oidc,evidence:baseEvidence,mode:'authorize',now});
    assert.equal(result.reason,'runtime-stop-or-owner-credential-denied');
    assert.ok(!queries.some(q=>q.sql.includes('WITH policy_lock AS')));
  }
  const queries=[];
  const accepted=await evaluateAndAuthorizeAutonomousRelease({db:makeFakeDb({queries}),oidcIdentity:oidc,evidence:baseEvidence,mode:'authorize',now});
  assert.equal(accepted.ok,true);
  const sql=queries.find(q=>q.sql.includes('WITH policy_lock AS')).sql;
  assert.match(sql,/c\.version = \$4 AND c\.paused = FALSE FOR SHARE/);
  assert.match(sql,/k\.revoked_at IS NULL FOR SHARE/);
});
