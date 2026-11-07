import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildGitLabAcceptanceReceipt } from '../scripts/write-gitlab-acceptance-receipt.mjs';

const SHA = 'a'.repeat(40);
const pipelineUrl = 'https://gitlab.example.test/group/project/-/pipelines/123';
const jobUrl = 'https://gitlab.example.test/group/project/-/jobs/456';

test('GitLab acceptance receipt binds the successful job to its exact checkout SHA', () => {
  const receipt = buildGitLabAcceptanceReceipt({
    observedSha: SHA,
    env: {
      CI: 'true',
      CI_PROJECT_PATH: 'michaelj.williams0123/Ultron.MW',
      CI_COMMIT_SHA: SHA,
      CI_COMMIT_REF_NAME: 'verify/exact-sha-example',
      CI_PIPELINE_SOURCE: 'push',
      CI_PIPELINE_ID: '123',
      CI_PIPELINE_URL: pipelineUrl,
      CI_JOB_ID: '456',
      CI_JOB_URL: jobUrl,
      CI_RUNNER_DESCRIPTION: 'GitLab shared runner',
    },
  });

  assert.deepEqual(receipt, {
    schemaVersion: 1,
    kind: 'gitlab-exact-sha-acceptance',
    result: 'passed',
    sourceAuthority: 'github:michaeljwilliams0123/Ultron.MW',
    verificationProvider: 'gitlab:michaelj.williams0123/Ultron.MW',
    sourceSha: SHA,
    observedCheckoutSha: SHA,
    ref: 'verify/exact-sha-example',
    pipelineSource: 'push',
    pipelineId: 123,
    pipelineUrl,
    jobId: 456,
    jobUrl,
    runner: 'GitLab shared runner',
    paidSpendAuthorizedUsd: 0,
    billingPolicy: 'included-quota-only-no-paid-fallback',
  });
});

test('GitLab acceptance receipt fails closed on a stale checkout or incomplete provenance', () => {
  const base = {
    CI: 'true',
    CI_PROJECT_PATH: 'michaelj.williams0123/Ultron.MW',
    CI_COMMIT_SHA: SHA,
    CI_COMMIT_REF_NAME: 'verify/exact-sha-example',
    CI_PIPELINE_SOURCE: 'push',
    CI_PIPELINE_ID: '123',
    CI_PIPELINE_URL: pipelineUrl,
    CI_JOB_ID: '456',
    CI_JOB_URL: jobUrl,
    CI_RUNNER_DESCRIPTION: 'GitLab shared runner',
  };

  assert.throws(
    () => buildGitLabAcceptanceReceipt({ env: base, observedSha: 'b'.repeat(40) }),
    /checkout SHA does not match CI_COMMIT_SHA/,
  );
  assert.throws(
    () => buildGitLabAcceptanceReceipt({ env: { ...base, CI_PIPELINE_URL: '' }, observedSha: SHA }),
    /CI_PIPELINE_URL is required/,
  );
  assert.throws(
    () => buildGitLabAcceptanceReceipt({ env: { ...base, CI_PROJECT_PATH: 'other/repo' }, observedSha: SHA }),
    /unexpected GitLab project/,
  );
});

test('GitLab workflow is verify-branch-only, exact-SHA, locked, and retains a bounded receipt', async () => {
  const yml = await readFile(resolve(import.meta.dirname, '../.gitlab-ci.yml'), 'utf8');

  assert.match(yml, /CI_PIPELINE_SOURCE == "push"/);
  assert.match(yml, /CI_COMMIT_BRANCH =~ \/\^verify\\\//);
  assert.match(yml, /when: never/);
  assert.match(yml, /test "\$\(git rev-parse HEAD\)" = "\$CI_COMMIT_SHA"/);
  assert.match(yml, /node scripts\/verify-audited-lockfile\.mjs/);
  assert.match(yml, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(yml, /node scripts\/verify\.mjs/);
  assert.match(yml, /node scripts\/write-gitlab-acceptance-receipt\.mjs/);
  assert.match(yml, /artifacts\/gitlab-exact-sha-acceptance\.json/);
  assert.match(yml, /expire_in: 7 days/);
  assert.doesNotMatch(yml, /secrets?|token|password|curl|wget|deploy|environment:/i);
});
