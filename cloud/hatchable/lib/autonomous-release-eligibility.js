import {
  CANONICAL_PROJECT_ID,
  classifyChangedPaths,
  computeStandingPolicySha256,
} from './standing-release-policy.js';
import {
  deploymentReceiptResource,
  normalizeDeploymentReceiptRequest,
} from './deployment-release-receipt/read.js';

const SHA = /^[a-f0-9]{40}$/;

export const STANDING_RECEIPT_GRANT_OPERATION = 'cloud.release-receipt.record';

function parseTargetVersion(target) {
  const m = /^hatchable-v([1-9][0-9]{0,8})$/.exec(target || '');
  return m ? Number(m[1]) : null;
}

export async function evaluateAndAuthorizeAutonomousRelease({
  db,
  oidcIdentity,
  evidence,
  mode = 'decision-only',
  now = Date.now(),
} = {}) {
  if (typeof db?.query !== 'function') return { ok: false, decision: 'denied', reason: 'db-unavailable' };
  if (!oidcIdentity || !SHA.test(oidcIdentity.sha || '')) {
    return { ok: false, decision: 'denied', reason: 'oidc-identity-invalid' };
  }
  if (mode !== 'decision-only' && mode !== 'authorize') {
    return { ok: false, decision: 'denied', reason: 'mode-invalid' };
  }

  // Re-read authoritative policy row
  const pRes = await db.query(
    `SELECT * FROM brain_standing_release_policies ORDER BY policy_version DESC LIMIT 1`,
  );
  const policyRow = pRes?.rows?.[0];
  if (!policyRow) return { ok: false, decision: 'denied', reason: 'no-standing-policy' };
  if (policyRow.revoked_at) return { ok: false, decision: 'denied', reason: 'policy-revoked' };
  if (mode === 'authorize' && !policyRow.enabled) return { ok: false, decision: 'denied', reason: 'policy-disabled' };

  const policyJson = policyRow.policy_json || {};
  const computedSha = computeStandingPolicySha256(policyJson);
  if (computedSha !== policyRow.policy_sha256) {
    return { ok: false, decision: 'denied', reason: 'policy-hash-mismatch' };
  }
  const nb = Date.parse(policyRow.not_before), exp = Date.parse(policyRow.expires_at);
  if (!Number.isFinite(nb) || !Number.isFinite(exp) || now < nb || now >= exp) {
    return { ok: false, decision: 'denied', reason: 'policy-expired-or-not-active' };
  }
  if (Number(policyRow.releases_consumed) >= Number(policyRow.max_releases)) {
    return { ok: false, decision: 'denied', reason: 'policy-release-budget-exhausted' };
  }
  if (Number(policyRow.max_cost_usd) !== 0) {
    return { ok: false, decision: 'denied', reason: 'zero-spend-policy-violated' };
  }
  if (oidcIdentity.workflowRef !== policyRow.workflow_ref) {
    return { ok: false, decision: 'denied', reason: 'workflow-ref-mismatch' };
  }

  // Independent evidence checks (never trust workflow-supplied assertions)
  if (!evidence || evidence.mainSha !== oidcIdentity.sha) {
    return { ok: false, decision: 'denied', reason: 'main-sha-mismatch' };
  }
  if (!evidence.ciVerified || evidence.ciSha !== oidcIdentity.sha) {
    return { ok: false, decision: 'denied', reason: 'ci-not-verified' };
  }
  if (!evidence.councilVerified) {
    return { ok: false, decision: 'denied', reason: 'council-not-verified' };
  }
  if (!evidence.provenanceVerified || evidence.provenanceSha !== oidcIdentity.sha) {
    return { ok: false, decision: 'denied', reason: 'sigstore-provenance-not-verified' };
  }

  // P0-1: Fail closed unless an independently fetched, non-truncated changed-file inventory is present.
  if (!evidence.changedFilesAvailable || !Array.isArray(evidence.changedFiles) || evidence.changedFilesTruncated) {
    return { ok: false, decision: 'denied', reason: 'changed-files-inventory-unavailable' };
  }

  const pathCheck = classifyChangedPaths(evidence.changedFiles, policyJson);
  if (!pathCheck.eligible) {
    return {
      ok: false,
      decision: 'human-required',
      reason: 'security-sensitive-path-changed',
      deniedPaths: pathCheck.deniedPaths,
      outsideAllowedPaths: pathCheck.outsideAllowedPaths,
    };
  }

  const live = evidence.liveDeployment;
  const deploymentVersion = parseTargetVersion(live?.target);
  if (!live?.verified || live.sourceSha !== oidcIdentity.sha || !deploymentVersion) {
    return { ok: false, decision: 'denied', reason: 'hatchable-manifest-not-verified' };
  }

  // P0-2: Fail closed unless the authoritative previous deployment version is established.
  if (!Number.isSafeInteger(evidence.previousDeploymentVersion) || evidence.previousDeploymentVersion < 1) {
    return { ok: false, decision: 'denied', reason: 'previous-deployment-version-unavailable' };
  }
  if (deploymentVersion <= evidence.previousDeploymentVersion && !policyJson.allowRollback) {
    return { ok: false, decision: 'human-required', reason: 'rollback-requires-owner-ceremony' };
  }

  const receiptKey = `${live.target}-${oidcIdentity.sha.slice(0, 8)}`.slice(0, 48);
  const normalized = normalizeDeploymentReceiptRequest({
    key: receiptKey,
    target: live.target,
    sourceSha: oidcIdentity.sha,
    artifactDigest: live.artifactDigest,
    manifestFileCount: live.manifestFileCount,
    independentReadback: true,
  });
  if (!normalized) return { ok: false, decision: 'denied', reason: 'deployment-request-invalid' };

  const eligibility = {
    policyId: policyRow.policy_id,
    policyVersion: Number(policyRow.policy_version),
    policySha256: policyRow.policy_sha256,
    stopVersion: Number(policyRow.stop_version),
    target: normalized.target,
    sourceSha: normalized.sourceSha,
    artifactDigest: normalized.artifactDigest,
    manifestFileCount: normalized.manifestFileCount,
    deploymentVersion,
    previousDeploymentVersion: evidence.previousDeploymentVersion,
    receiptKey: normalized.key,
  };

  if (mode === 'decision-only') {
    return { ok: true, decision: 'authorized', mode: 'decision-only', eligibility };
  }

  // P0-3: Authority separation — use non-deploy operation 'cloud.release-receipt.record'.
  const grantId = `standing-${policyRow.policy_id}-v${policyRow.policy_version}-${oidcIdentity.jti.slice(0, 32)}`;
  const resource = deploymentReceiptResource(normalized);
  const digest = normalized.artifactDigest;
  const expiresAtIso = new Date(now + 300000).toISOString();

  const sql = `
    WITH policy_lock AS (
      SELECT policy_id, policy_version, policy_sha256, stop_version, max_releases,
             releases_consumed, enabled, revoked_at, not_before, expires_at
      FROM brain_standing_release_policies
      WHERE policy_id = $1 AND policy_version = $2 AND policy_sha256 = $3
        AND stop_version = $4 AND enabled = TRUE AND revoked_at IS NULL
        AND not_before <= clock_timestamp() AND expires_at > clock_timestamp()
        AND releases_consumed < max_releases
      FOR UPDATE
    ), existing_claim AS (
      SELECT c.id, c.receipt_id, c.jti, c.target, c.source_sha, c.artifact_digest, c.deployment_version
      FROM brain_autonomous_release_claims c
      WHERE c.jti = $5 OR (c.project_id = $6 AND c.source_sha = $7 AND c.artifact_digest = $8 AND c.deployment_version = $9)
    ), existing_receipt AS (
      SELECT id AS receipt_id FROM brain_deployment_release_receipts
      WHERE receipt_key = $10 OR (target = $11 AND source_sha = $7 AND artifact_digest = $8)
    ), admitted_grant AS (
      INSERT INTO brain_authority_grants(grant_id, objective_id, actor, operation, resource, policy_sha, expires_at)
      SELECT $12, $10, 'github:standing-policy-v1', '${STANDING_RECEIPT_GRANT_OPERATION}', $13, $3, $14::timestamptz
      FROM (TABLE policy_lock) AS pl
      WHERE NOT EXISTS (SELECT 1 FROM (TABLE existing_claim) AS ec)
        AND NOT EXISTS (SELECT 1 FROM (TABLE existing_receipt) AS er)
      ON CONFLICT (grant_id) DO NOTHING
      RETURNING grant_id
    ), inserted_receipt AS (
      INSERT INTO brain_deployment_release_receipts(
        receipt_key, target, source_sha, artifact_digest, manifest_file_count,
        independent_readback, grant_id, policy_sha, profile_version, stop_version
      )
      SELECT $10, $11, $7, $8, $15, TRUE, ag.grant_id, $3, $2, $4
      FROM (TABLE admitted_grant) AS ag
      RETURNING id AS receipt_id
    ), inserted_claim AS (
      INSERT INTO brain_autonomous_release_claims(
        policy_id, policy_version, policy_sha256, jti, workflow_run_id, workflow_attempt,
        project_id, target, source_sha, artifact_digest, deployment_version, receipt_id,
        decision, reason
      )
      SELECT $1, $2, $3, $5, $16, $17, $6, $11, $7, $8, $9, ir.receipt_id, 'authorized', 'standing-policy-v1'
      FROM (TABLE inserted_receipt) AS ir
      RETURNING id AS claim_id, receipt_id
    ), bumped_policy AS (
      UPDATE brain_standing_release_policies p
      SET releases_consumed = p.releases_consumed + 1
      FROM (TABLE inserted_claim) AS ic
      WHERE p.policy_id = $1
      RETURNING p.releases_consumed
    )
    SELECT 'recorded' AS outcome, ic.claim_id, ic.receipt_id, bp.releases_consumed
    FROM (TABLE inserted_claim) AS ic JOIN (TABLE bumped_policy) AS bp ON TRUE
    UNION ALL
    SELECT 'existing', ec.id, ec.receipt_id, NULL::integer
    FROM (TABLE existing_claim) AS ec
    WHERE NOT EXISTS (SELECT 1 FROM (TABLE inserted_claim) AS ic)
      AND ec.source_sha = $7 AND ec.artifact_digest = $8 AND ec.deployment_version = $9
    UNION ALL
    SELECT 'conflict', ec.id, ec.receipt_id, NULL::integer
    FROM (TABLE existing_claim) AS ec
    WHERE NOT EXISTS (SELECT 1 FROM (TABLE inserted_claim) AS ic)
      AND NOT (ec.source_sha = $7 AND ec.artifact_digest = $8 AND ec.deployment_version = $9)
    UNION ALL
    SELECT 'denied', NULL::bigint, NULL::bigint, NULL::integer
    WHERE NOT EXISTS (SELECT 1 FROM (TABLE inserted_claim) AS ic)
      AND NOT EXISTS (SELECT 1 FROM (TABLE existing_claim) AS ec)`;

  const res = await db.query(sql, [
    policyRow.policy_id,
    Number(policyRow.policy_version),
    policyRow.policy_sha256,
    Number(policyRow.stop_version),
    oidcIdentity.jti,
    CANONICAL_PROJECT_ID,
    normalized.sourceSha,
    digest,
    deploymentVersion,
    normalized.key,
    normalized.target,
    grantId,
    resource,
    expiresAtIso,
    normalized.manifestFileCount,
    oidcIdentity.workflowRunId,
    oidcIdentity.workflowAttempt,
  ]);
  const row = res?.rows?.[0];
  if (!row || row.outcome === 'denied') {
    return { ok: false, decision: 'denied', reason: 'standing-policy-transaction-denied' };
  }
  if (row.outcome === 'conflict') {
    return { ok: false, decision: 'denied', reason: 'oidc-jti-or-tuple-conflict' };
  }
  return {
    ok: true,
    decision: 'authorized',
    mode: 'authorize',
    reused: row.outcome === 'existing',
    receiptId: Number(row.receipt_id),
    claimId: Number(row.claim_id),
    eligibility,
  };
}
