import { createHash } from 'node:crypto';
import { verifyOwnerPasskeyAssertion } from './webauthn-owner.js';

export const STANDING_POLICY_SCHEMA = 'ultron.release-standing-policy.v1';
export const CANONICAL_REPO = 'michaeljwilliams0123/Ultron.MW';
export const CANONICAL_REPO_ID = 1424939667;
export const CANONICAL_PROJECT_ID = 'proj_A6GCXRSKizko';
export const CANONICAL_ENVIRONMENT = 'production';
export const CANONICAL_BRANCH_REF = 'refs/heads/main';
export const CANONICAL_WORKFLOW_REF = 'michaeljwilliams0123/Ultron.MW/.github/workflows/release-authorize.yml@refs/heads/main';
export const CANONICAL_COUNCIL_APP_ID = 5765239;
export const CANONICAL_OWNER = 'michaeljwilliams0123';

export const DEFAULT_DENIED_SECURITY_PATHS = Object.freeze([
  '.github/workflows/**',
  '.github/rulesets/**',
  'cloud/hatchable/lib/owner-passkey*',
  'cloud/hatchable/lib/standing-release-policy.js',
  'cloud/hatchable/lib/github-oidc-release-identity.js',
  'cloud/hatchable/lib/autonomous-release-eligibility.js',
  'cloud/hatchable/lib/deployment-release-receipt*',
  'cloud/hatchable/api/brain/release-standing-policy.js',
  'cloud/hatchable/api/brain/deployment-release-authorize.js',
  'cloud/hatchable/api/brain/deployment-release-receipt.js',
  'cloud/hatchable/migrations/**',
  'cloudflare/edge-shield/src/security.ts',
  'cloudflare/edge-shield/src/proxy.ts',
  'cloudflare/edge-shield/src/admin.ts',
  'cloudflare/edge-shield/src/release-readback.ts',
  'cloudflare/edge-shield/src/release-authorization.ts',
  'cloudflare/edge-shield/src/workflows/release-proof.ts',
  'cloudflare/edge-shield/src/index.ts',
  'cloudflare/edge-shield/src/queue.ts',
  'cloudflare/edge-shield/src/webhooks.ts',
  'cloudflare/edge-shield/wrangler*.toml',
  'cloud/hatchable/api/brain/release-authorization-wakeup.js',
  'cloud/hatchable/lib/autonomous-release-manifest.js',
  'cloud/hatchable/lib/release-proof*',
  'cloud/hatchable/lib/hatchable-manifest-readback.js',
  'cloud/hatchable/lib/independent-source-inventory.js',
  'cloud/hatchable/lib/council-deep-dispatch.js',
  'cloud/hatchable/lib/github-operator-release-fetch.js',
]);

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}

export function canonicalStandingPolicyPayload(policy) {
  return JSON.stringify(sortKeysDeep({
    schema: STANDING_POLICY_SCHEMA,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    ownerHandle: CANONICAL_OWNER,
    ownerCredentialId: policy.ownerCredentialId,
    notBefore: policy.notBefore,
    expiresAt: policy.expiresAt,
    stopVersion: policy.stopVersion,
    maxReleases: policy.maxReleases,
    repository: CANONICAL_REPO,
    repositoryId: CANONICAL_REPO_ID,
    projectId: CANONICAL_PROJECT_ID,
    environment: CANONICAL_ENVIRONMENT,
    branchRef: CANONICAL_BRANCH_REF,
    workflowRef: policy.workflowRef || CANONICAL_WORKFLOW_REF,
    councilAppId: CANONICAL_COUNCIL_APP_ID,
    targetPrefix: policy.targetPrefix || 'hatchable-v',
    allowRollback: Boolean(policy.allowRollback),
    allowedPathClasses: Array.isArray(policy.allowedPathClasses) ? [...policy.allowedPathClasses].sort() : ['**'],
    deniedPaths: Array.isArray(policy.deniedPaths) ? [...policy.deniedPaths].sort() : [...DEFAULT_DENIED_SECURITY_PATHS].sort(),
    requiredCiContexts: Array.isArray(policy.requiredCiContexts) ? [...policy.requiredCiContexts].sort() : ['Verify'],
    requiredProvenancePredicate: policy.requiredProvenancePredicate || 'ultron.release-eligibility.v1',
    maxCostUsd: 0,
    ...(typeof policy.enabled === 'boolean' ? { enabled: policy.enabled } : {}),
  }));
}

export function computeStandingPolicySha256(policy) {
  return createHash('sha256').update(canonicalStandingPolicyPayload(policy)).digest('hex');
}

export function matchPathPattern(filePath, pattern) {
  if (typeof filePath !== 'string' || typeof pattern !== 'string' || !filePath || !pattern) return false;
  const normFile = filePath.replace(/^\/+/, '');
  const normPat = pattern.replace(/^\/+/, '');
  const escaped = normPat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`).test(normFile);
}

export function classifyChangedPaths(changedFiles, policy) {
  const denied = Array.isArray(policy?.deniedPaths) && policy.deniedPaths.length
    ? [...DEFAULT_DENIED_SECURITY_PATHS,...policy.deniedPaths]
    : DEFAULT_DENIED_SECURITY_PATHS;
  const allowed = Array.isArray(policy?.allowedPathClasses) && policy.allowedPathClasses.length
    ? policy.allowedPathClasses
    : ['**'];
  const deniedPaths = [];
  const outsideAllowedPaths = [];
  for (const file of changedFiles || []) {
    if (denied.some(pat => matchPathPattern(file, pat))) {
      deniedPaths.push(file);
    } else if (!allowed.some(pat => matchPathPattern(file, pat))) {
      outsideAllowedPaths.push(file);
    }
  }
  return {
    eligible: deniedPaths.length === 0 && outsideAllowedPaths.length === 0,
    deniedPaths,
    outsideAllowedPaths,
  };
}

export function validateStandingPolicyShape(policy) {
  if (!policy || typeof policy !== 'object') return 'policy-missing';
  if (policy.schema !== STANDING_POLICY_SCHEMA) return 'policy-schema-invalid';
  if (!/^srp-[a-z0-9-]{8,64}$/.test(policy.policyId || '')) return 'policy-id-invalid';
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion < 1) return 'policy-version-invalid';
  if (!Number.isSafeInteger(policy.stopVersion) || policy.stopVersion < 1) return 'stop-version-invalid';
  if (!Number.isSafeInteger(policy.maxReleases) || policy.maxReleases < 1 || policy.maxReleases > 100) return 'max-releases-invalid';
  if (policy.repository !== CANONICAL_REPO || policy.repositoryId !== CANONICAL_REPO_ID) return 'repository-invalid';
  if (policy.projectId !== CANONICAL_PROJECT_ID || policy.environment !== CANONICAL_ENVIRONMENT) return 'target-invalid';
  if (policy.branchRef !== CANONICAL_BRANCH_REF) return 'branch-invalid';
  if (policy.councilAppId !== CANONICAL_COUNCIL_APP_ID) return 'council-app-invalid';
  if (policy.maxCostUsd !== 0) return 'zero-spend-required';
  const nb = Date.parse(policy.notBefore || ''), exp = Date.parse(policy.expiresAt || '');
  if (!Number.isFinite(nb) || !Number.isFinite(exp) || exp <= nb || (exp - nb) > 31 * 86400 * 1000) return 'policy-window-invalid';
  if (typeof policy.ownerCredentialId !== 'string' || policy.ownerCredentialId.length < 16) return 'owner-credential-invalid';
  return null;
}

function policyChallenge(digest) {
  return btoa(String.fromCharCode(...digest.match(/../g).map(hex => parseInt(hex, 16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function prepareStandingPolicy({db, credentialId, maxReleases, days, enabled, now = Date.now()} = {}) {
  if (typeof db?.query !== 'function') return {ok:false,reason:'db-unavailable'};
  if (typeof credentialId !== 'string' || !/^[A-Za-z0-9_-]{16,1024}$/.test(credentialId) ||
      !Number.isSafeInteger(maxReleases) || maxReleases < 1 || maxReleases > 100 ||
      !Number.isSafeInteger(days) || days < 1 || days > 31 || typeof enabled !== 'boolean') {
    return {ok:false,reason:'policy-prepare-input-invalid'};
  }
  const observed=await db.query(
    `SELECT c.version AS stop_version,
       (SELECT COALESCE(MAX(policy_version),0)+1 FROM brain_standing_release_policies) AS next_version
       FROM brain_runtime_control c JOIN brain_owner_passkeys k
       ON k.credential_id=$1 AND k.revoked_at IS NULL WHERE c.id=1 AND c.paused=FALSE`,[credentialId]);
  const row=observed?.rows?.[0];
  if (!row) return {ok:false,reason:'runtime-stop-or-owner-credential-denied'};
  const policy={
    schema:STANDING_POLICY_SCHEMA,policyId:'srp-'+globalThis.crypto.randomUUID().replace(/-/g,''),
    policyVersion:Number(row.next_version),ownerHandle:CANONICAL_OWNER,ownerCredentialId:credentialId,
    notBefore:new Date(now).toISOString(),expiresAt:new Date(now+days*86400000).toISOString(),
    stopVersion:Number(row.stop_version),maxReleases,repository:CANONICAL_REPO,repositoryId:CANONICAL_REPO_ID,
    projectId:CANONICAL_PROJECT_ID,environment:CANONICAL_ENVIRONMENT,branchRef:CANONICAL_BRANCH_REF,
    workflowRef:CANONICAL_WORKFLOW_REF,councilAppId:CANONICAL_COUNCIL_APP_ID,targetPrefix:'hatchable-v',
    allowRollback:false,allowedPathClasses:['**'],deniedPaths:[...DEFAULT_DENIED_SECURITY_PATHS],
    requiredCiContexts:['Verify'],requiredProvenancePredicate:'ultron.release-eligibility.v1',maxCostUsd:0,enabled,
  };
  const shapeErr=validateStandingPolicyShape(policy);
  if(shapeErr)return {ok:false,reason:shapeErr};
  policy.policySha256=computeStandingPolicySha256(policy);
  const saved=await db.query(
    `INSERT INTO brain_standing_policy_challenges
       (policy_id,policy_sha256,credential_id,policy_version,stop_version,expires_at)
       VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')
       RETURNING expires_at`,
    [policy.policyId,policy.policySha256,credentialId,policy.policyVersion,policy.stopVersion]);
  if(saved?.rows?.length!==1)return {ok:false,reason:'policy-challenge-unavailable'};
  return {ok:true,policy,challenge:policyChallenge(policy.policySha256),rpId:'ultron-mw-cloud.hatchable.site',
    challengeExpiresAt:new Date(saved.rows[0].expires_at).toISOString()};
}

export async function enrollStandingPolicy({
  db,
  policy,
  passkeyProof,
  enabled = false,
  now = Date.now(),
} = {}) {
  if (typeof db?.query !== 'function') return { ok: false, reason: 'db-unavailable' };
  const shapeErr = validateStandingPolicyShape(policy);
  if (shapeErr) return { ok: false, reason: shapeErr };
  if (typeof policy.enabled !== 'boolean' || policy.enabled !== enabled) {
    return { ok: false, reason: 'signed-enabled-state-mismatch' };
  }
  if (!passkeyProof || passkeyProof.credentialId !== policy.ownerCredentialId) {
    return { ok: false, reason: 'owner-passkey-mismatch' };
  }
  const keyRes = await db.query(
    `SELECT credential_id, public_key_spki, revoked_at FROM brain_owner_passkeys WHERE credential_id = $1`,
    [policy.ownerCredentialId],
  );
  const keyRow = keyRes?.rows?.[0];
  if (!keyRow || keyRow.revoked_at) return { ok: false, reason: 'owner-passkey-not-active' };

  const policySha256 = computeStandingPolicySha256(policy);
  if (policy.policySha256 && policy.policySha256 !== policySha256) {
    return { ok: false, reason: 'policy-sha-mismatch' };
  }
  try {
    await verifyOwnerPasskeyAssertion({
      credentialId: passkeyProof.credentialId,
      expectedCredentialId: keyRow.credential_id,
      publicKeySpki: keyRow.public_key_spki,
      challenge: policyChallenge(policySha256),
      authenticatorData: passkeyProof.authenticatorData,
      clientDataJSON: passkeyProof.clientDataJSON,
      signature: passkeyProof.signature,
    });
  } catch {
    return { ok: false, reason: 'owner-passkey-signature-invalid' };
  }

  const res = await db.query(
    `WITH claimed AS (
       UPDATE brain_standing_policy_challenges ch SET used_at=clock_timestamp()
       WHERE ch.policy_id=$1 AND ch.policy_sha256=$3 AND ch.credential_id=$5
         AND ch.policy_version=$2 AND ch.stop_version=$6 AND ch.used_at IS NULL
         AND ch.expires_at>clock_timestamp()
         AND EXISTS(SELECT 1 FROM brain_runtime_control c
           WHERE c.id=1 AND c.version=$6 AND c.paused=FALSE FOR SHARE)
         AND EXISTS(SELECT 1 FROM brain_owner_passkeys k
           WHERE k.credential_id=$5 AND k.revoked_at IS NULL FOR SHARE)
         AND NOT EXISTS(SELECT 1 FROM brain_standing_release_policies p WHERE p.policy_version >= $2)
       RETURNING policy_id
     ), inserted AS (
     INSERT INTO brain_standing_release_policies (
       policy_id, policy_version, policy_sha256, owner_handle, owner_credential_id,
       stop_version, max_releases, repository, repository_id, project_id, environment,
       branch_ref, workflow_ref, council_app_id, max_cost_usd, enabled, policy_json,
       owner_signature, enrolled_at, not_before, expires_at
     ) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, $15, $16::jsonb,
       $17::jsonb, to_timestamp($18), $19::timestamptz, $20::timestamptz FROM claimed
       ON CONFLICT DO NOTHING
       RETURNING policy_id, policy_version, policy_sha256, enabled, stop_version, expires_at
     ) SELECT * FROM inserted`,
    [
      policy.policyId,
      policy.policyVersion,
      policySha256,
      CANONICAL_OWNER,
      policy.ownerCredentialId,
      policy.stopVersion,
      policy.maxReleases,
      CANONICAL_REPO,
      CANONICAL_REPO_ID,
      CANONICAL_PROJECT_ID,
      CANONICAL_ENVIRONMENT,
      CANONICAL_BRANCH_REF,
      policy.workflowRef || CANONICAL_WORKFLOW_REF,
      CANONICAL_COUNCIL_APP_ID,
      Boolean(enabled),
      JSON.stringify({ ...policy, policySha256 }),
      JSON.stringify({ credentialId: passkeyProof.credentialId, policySha256 }),
      Math.floor(now / 1000),
      policy.notBefore,
      policy.expiresAt,
    ],
  );
  if (res?.rows?.length !== 1) return { ok: false, reason: 'policy-challenge-stale-or-consumed' };
  return { ok: true, policy: res.rows[0] };
}

export async function revokeStandingPolicy({ db, policyId, reason = 'owner-revoked', bumpStop = true } = {}) {
  if (typeof db?.query !== 'function' || !policyId) return { ok: false, reason: 'invalid-revoke-request' };
  const res = await db.query(
    `UPDATE brain_standing_release_policies
     SET revoked_at = COALESCE(revoked_at, now()),
         revoked_reason = COALESCE(revoked_reason, $2),
         enabled = FALSE,
         stop_version = CASE WHEN $3 THEN stop_version + 1 ELSE stop_version END
     WHERE policy_id = $1
     RETURNING policy_id, policy_version, stop_version, revoked_at, revoked_reason, enabled`,
    [policyId, String(reason || 'owner-revoked').slice(0, 200), Boolean(bumpStop)],
  );
  if (res?.rows?.length !== 1) return { ok: false, reason: 'policy-not-found' };
  return { ok: true, policy: res.rows[0] };
}

export async function readActiveStandingPolicy({ db } = {}) {
  if (typeof db?.query !== 'function') return null;
  const res = await db.query(
    `SELECT * FROM brain_standing_release_policies
     ORDER BY policy_version DESC LIMIT 1`,
  );
  return res?.rows?.[0] || null;
}
