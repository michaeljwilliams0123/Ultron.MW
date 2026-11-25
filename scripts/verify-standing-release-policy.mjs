#!/usr/bin/env node
/** Offline audit for standing release policy schema, denied paths, and OIDC verifier invariants. */
import { readFileSync } from 'node:fs';
import {
  CANONICAL_COUNCIL_APP_ID,
  CANONICAL_PROJECT_ID,
  CANONICAL_REPO,
  CANONICAL_REPO_ID,
  DEFAULT_DENIED_SECURITY_PATHS,
  STANDING_POLICY_SCHEMA,
  classifyChangedPaths,
  computeStandingPolicySha256,
  validateStandingPolicyShape,
} from '../cloud/hatchable/lib/standing-release-policy.js';

const samplePolicy = {
  schema: STANDING_POLICY_SCHEMA,
  policyId: 'srp-audit-20261124',
  policyVersion: 1,
  ownerCredentialId: 'cred-owner-audit-1234567890',
  notBefore: '2026-11-24T00:00:00Z',
  expiresAt: '2026-12-24T00:00:00Z',
  stopVersion: 1,
  maxReleases: 20,
  repository: CANONICAL_REPO,
  repositoryId: CANONICAL_REPO_ID,
  projectId: CANONICAL_PROJECT_ID,
  environment: 'production',
  branchRef: 'refs/heads/main',
  councilAppId: CANONICAL_COUNCIL_APP_ID,
  maxCostUsd: 0,
};

const shapeErr = validateStandingPolicyShape(samplePolicy);
if (shapeErr) {
  console.error('Standing policy shape check failed:', shapeErr);
  process.exit(1);
}

for (const sensitive of [
  '.github/workflows/verify.yml',
  'cloud/hatchable/lib/standing-release-policy.js',
  'cloud/hatchable/migrations/0053_standing_release_policy.sql',
  'cloudflare/edge-shield/src/proxy.ts',
]) {
  const check = classifyChangedPaths([sensitive], samplePolicy);
  if (check.eligible) {
    console.error('Sensitive path was not denied:', sensitive);
    process.exit(1);
  }
}

const route = readFileSync(new URL('../cloud/hatchable/api/brain/deployment-release-authorize.js', import.meta.url), 'utf8');
if (!route.includes('verifyGithubReleaseOidc') || !route.includes('evaluateAndAuthorizeAutonomousRelease')) {
  console.error('Authorization route missing OIDC or eligibility check');
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  schema: STANDING_POLICY_SCHEMA,
  deniedPatterns: DEFAULT_DENIED_SECURITY_PATHS.length,
  samplePolicySha256: computeStandingPolicySha256(samplePolicy),
}));
