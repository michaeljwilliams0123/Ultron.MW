import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_DENIED_SECURITY_PATHS,
  computeStandingPolicySha256,
  validateStandingPolicyShape,
} from '../cloud/hatchable/lib/standing-release-policy.js';

test('release-owner.html includes standing policy enrollment panel and script', () => {
  const html = fs.readFileSync(new URL('../cloud/hatchable/public/release-owner.html', import.meta.url), 'utf8');
  assert.match(html, /id="standing-policy-section"/);
  assert.match(html, /id="sp-enroll"/);
  assert.match(html, /id="sp-revoke"/);
  assert.match(html, /<script src="\/standing-policy\.js" defer><\/script>/);
});

test('standing-policy.js denied paths and canonical SHA-256 match server policy helper', async () => {
  const js = fs.readFileSync(new URL('../cloud/hatchable/public/standing-policy.js', import.meta.url), 'utf8');
  for (const denied of DEFAULT_DENIED_SECURITY_PATHS) {
    assert.ok(js.includes(`'${denied}'`), `Missing denied path in standing-policy.js: ${denied}`);
  }
  const policy = {
    schema: 'ultron.release-standing-policy.v1',
    policyId: 'srp-uitest123456',
    policyVersion: 1,
    ownerHandle: 'michaeljwilliams0123',
    ownerCredentialId: '4UnIsY659zyDO2d0uS8Q6p6jjv8',
    notBefore: '2026-11-25T00:00:00.000Z',
    expiresAt: '2026-12-26T00:00:00.000Z',
    stopVersion: 7,
    maxReleases: 100,
    repository: 'michaeljwilliams0123/Ultron.MW',
    repositoryId: 1424939667,
    projectId: 'proj_A6GCXRSKizko',
    environment: 'production',
    branchRef: 'refs/heads/main',
    workflowRef: 'michaeljwilliams0123/Ultron.MW/.github/workflows/release-authorize.yml@refs/heads/main',
    councilAppId: 5765239,
    targetPrefix: 'hatchable-v',
    allowRollback: false,
    allowedPathClasses: ['**'],
    deniedPaths: [...DEFAULT_DENIED_SECURITY_PATHS],
    requiredCiContexts: ['Verify'],
    requiredProvenancePredicate: 'ultron.release-eligibility.v1',
    maxCostUsd: 0,
  };
  assert.equal(validateStandingPolicyShape(policy), null);
  const serverSha = computeStandingPolicySha256(policy);
  assert.match(serverSha, /^[a-f0-9]{64}$/);
});
