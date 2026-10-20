/** Ultron velocity mode (~85% autonomy pressure). Default OFF.
 * ULTRON_VELOCITY=1 raises multifile/throughput limits, softens non-critical
 * policy holds, and makes the self-observer passive. Does NOT:
 * - fail-open required CI
 * - skip syntax preflight on model source
 * - allow workflow / .github writes
 * - grant action authority to the GrokBot council
 */
export function velocityEnabled(env = process.env) {
  return env.ULTRON_VELOCITY === '1' || env.ULTRON_VELOCITY === 'true';
}

export function multifileLimits(env = process.env) {
  if (velocityEnabled(env)) {
    return Object.freeze({ maxFiles: 12, maxFileBytes: 24000, maxTotalBytes: 96000, maxObjective: 600 });
  }
  return Object.freeze({ maxFiles: 4, maxFileBytes: 6500, maxTotalBytes: 18000, maxObjective: 300 });
}

export function governorSoftHold(env = process.env) {
  return velocityEnabled(env)
    ? Object.freeze({ minEvidence: 0.45, minConfidence: 0.4, maxUnknowns: 8, maxConflicts: 2 })
    : Object.freeze({ minEvidence: 0.7, minConfidence: 0.7, maxUnknowns: 0, maxConflicts: 0 });
}

export function observerMode(env = process.env) {
  return velocityEnabled(env) ? 'passive' : 'active';
}

export function verifyPolicy(env = process.env) {
  return velocityEnabled(env)
    ? Object.freeze({ mode: 'advisory', minSuccessRatio: 0.5 })
    : Object.freeze({ mode: 'blocking', minSuccessRatio: 1.0 });
}
