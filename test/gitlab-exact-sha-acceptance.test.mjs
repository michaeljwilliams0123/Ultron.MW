import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildGitLabAcceptanceReceipt,
  readDetachedGitHead,
  verifyGitHubSourceCommit,
} from '../scripts/write-gitlab-acceptance-receipt.mjs';

const SHA = 'a'.repeat(40);
const pipelineUrl = 'https://gitlab.example.test/group/project/-/pipelines/123';
const jobUrl = 'https://gitlab.example.test/group/project/-/jobs/456';

test('GitLab acceptance receipt binds the successful job to its exact checkout SHA', () => {
  const receipt = buildGitLabAcceptanceReceipt({
    observedSha: SHA,
    observedGitHubSourceSha: SHA,
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
    observedGitHubSourceSha: SHA,
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
    () => buildGitLabAcceptanceReceipt({ env: base, observedSha: 'b'.repeat(40), observedGitHubSourceSha: SHA }),
    /checkout SHA does not match CI_COMMIT_SHA/,
  );
  assert.throws(
    () => buildGitLabAcceptanceReceipt({ env: { ...base, CI_PIPELINE_URL: '' }, observedSha: SHA, observedGitHubSourceSha: SHA }),
    /CI_PIPELINE_URL is required/,
  );
  assert.throws(
    () => buildGitLabAcceptanceReceipt({ env: { ...base, CI_PROJECT_PATH: 'other/repo' }, observedSha: SHA, observedGitHubSourceSha: SHA }),
    /unexpected GitLab project/,
  );
  assert.throws(
    () => buildGitLabAcceptanceReceipt({ env: base, observedSha: SHA, observedGitHubSourceSha: 'b'.repeat(40) }),
    /GitHub source SHA does not match CI_COMMIT_SHA/,
  );
});

test('GitLab acceptance independently observes the exact commit in GitHub without credentials', async () => {
  const requests = [];
  const observedSha = await verifyGitHubSourceCommit({
    sourceSha: SHA,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ sha: SHA }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    },
  });

  assert.equal(observedSha, SHA);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/commits/${SHA}`);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers.authorization, undefined);
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test('GitLab acceptance fails closed when GitHub lacks or mismatches the exact source commit', async () => {
  await assert.rejects(
    () => verifyGitHubSourceCommit({
      sourceSha: SHA,
      fetchImpl: async () => new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /GitHub source lookup failed with HTTP 404/,
  );

  await assert.rejects(
    () => verifyGitHubSourceCommit({
      sourceSha: SHA,
      fetchImpl: async () => new Response(JSON.stringify({ sha: 'b'.repeat(40) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /GitHub source response does not match requested SHA/,
  );
});

test('GitLab receipt reads the detached checkout identity without requiring a git executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ultron-gitlab-head-'));
  try {
    await mkdir(join(directory, '.git'));
    await writeFile(join(directory, '.git', 'HEAD'), `${SHA}\n`);
    assert.equal(await readDetachedGitHead(directory), SHA);

    await writeFile(join(directory, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await assert.rejects(() => readDetachedGitHead(directory), /detached Git HEAD is required/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('GitLab workflow is verify-branch-only, exact-SHA, locked, and retains a bounded receipt', async () => {
  const yml = await readFile(resolve(import.meta.dirname, '../.gitlab-ci.yml'), 'utf8');

  assert.match(yml, /CI_PIPELINE_SOURCE == "push"/);
  assert.match(yml, /CI_COMMIT_BRANCH =~ \/\^verify\\\//);
  assert.match(yml, /when: never/);
  assert.match(
    yml,
    /node:22\.21\.1-bookworm@sha256:b84d52cd45bfe261096ccbf886955d431b8b9ed01b72eaef588e8886bda09e78/,
  );
  assert.doesNotMatch(yml, /bookworm-slim/);
  assert.match(yml, /test "\$\(cat \.git\/HEAD\)" = "\$CI_COMMIT_SHA"/);
  assert.doesNotMatch(yml, /git rev-parse|apt-get|apk add/);
  assert.match(yml, /node scripts\/verify-audited-lockfile\.mjs/);
  assert.match(yml, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(yml, /node scripts\/verify\.mjs/);
  assert.match(yml, /node scripts\/write-gitlab-acceptance-receipt\.mjs/);
  assert.match(yml, /artifacts\/gitlab-exact-sha-acceptance\.json/);
  assert.match(yml, /expire_in: 7 days/);
  assert.doesNotMatch(yml, /secrets?|token|password|curl|wget|deploy|environment:/i);
});
