/**
 * Bounded throughput-only adoption of the historical velocity proposal.
 * No mode may change required CI, exact-head admission, identity, secret
 * handling, model source syntax validation, or protected-main merge policy.
 */
export function capacityLimits(env=process.env) {
  const expanded=env?.ULTRON_CAPACITY==='expanded';
  return Object.freeze({
    mode:expanded?'expanded':'standard',
    maxFiles:expanded?6:4,
    maxFileBytes:6500,
    maxTotalBytes:expanded?22000:18000,
    maxObjective:300,
    requiredVerify:'blocking',
    modelSafety:'enforced',
    permissionMode:'owner-only',
  });
}
