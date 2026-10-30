/**
 * Owner-autonomy policy for Ultron.
 * Default posture: maximize useful work for the single owner while keeping
 * hard floors (no secret leakage, no unprotected main push, syntax preflight).
 *
 * Enable with OWNER_MODE=1, ULTRON_AUTONOMY=1, or ULTRON_VELOCITY=1.
 */

export function ownerAutonomyEnabled(env = process.env) {
  return (
    env.OWNER_MODE === '1' ||
    env.OWNER_MODE === 'true' ||
    env.ULTRON_AUTONOMY === '1' ||
    env.ULTRON_AUTONOMY === 'true' ||
    env.ULTRON_VELOCITY === '1' ||
    env.ULTRON_VELOCITY === 'true'
  );
}

/** Multifile / planning budgets under owner autonomy vs baseline. */
export function autonomyLimits(env = process.env) {
  if (ownerAutonomyEnabled(env)) {
    return Object.freeze({
      mode: 'owner-autonomy',
      maxFiles: 12,
      maxFileBytes: 24000,
      maxTotalBytes: 96000,
      maxObjectiveChars: 800,
      maxBodyChars: 8000,
      governorMinEvidence: 0.45,
      governorMinConfidence: 0.4,
      governorMaxUnknowns: 8,
      governorMaxConflicts: 2,
      observer: 'passive',
      verifyPreference: 'advisory-for-planning',
    });
  }
  return Object.freeze({
    mode: 'baseline',
    maxFiles: 4,
    maxFileBytes: 6500,
    maxTotalBytes: 18000,
    maxObjectiveChars: 300,
    maxBodyChars: 3000,
    governorMinEvidence: 0.7,
    governorMinConfidence: 0.7,
    governorMaxUnknowns: 0,
    governorMaxConflicts: 0,
    observer: 'active',
    verifyPreference: 'blocking',
  });
}

/** Hard floors that autonomy never removes. */
export function autonomyHardFloors() {
  return Object.freeze({
    noPushToProtectedMainFromCouncil: true,
    noFailOpenRequiredCi: true,
    syntaxPreflightRequired: true,
    noWorkflowWritesFromModelPatch: true,
    advisoryCouncilNoExecutionAuthority: true,
    secretsNeverLogged: true,
  });
}

export function autonomyDoctrine() {
  return Object.freeze({
    slogan: 'Ultron works for the owner, not the other way around.',
    principle: 'Maximize owner velocity; keep irreversible and security-sensitive gates.',
    enabledBy: ['OWNER_MODE=1', 'ULTRON_AUTONOMY=1', 'ULTRON_VELOCITY=1'],
    floors: autonomyHardFloors(),
  });
}
