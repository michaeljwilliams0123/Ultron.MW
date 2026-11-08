import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildGitHubVerificationReceipt } from '../scripts/write-github-verification-receipt.mjs';

const SHA = 'b'.repeat(40);
const RUN_URL = 'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/123';

test('verification receipt binds the passing workflow run to the exact checked-out source', () => {
  const receipt = buildGitHubVerificationReceipt({
    observedSha: SHA,
    env: {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'michaeljwilliams0123/Ultron.MW',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_WORKFLOW: 'Ultron core verification',
      GITHUB_WORKFLOW_REF: `michaeljwilliams0123/Ultron.MW/.github/workflows/verify.yml@refs/pull/313/merge`,
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_JOB: 'attested-receipt',
      SOURCE_SHA: SHA,
    },
  });

  assert.deepEqual(receipt, {
    schemaVersion: 1,
    kind: 'github-attested-verification-receipt',
    result: 'passed',
    repository: 'michaeljwilliams0123/Ultron.MW',
    sourceSha: SHA,
    observedCheckoutSha: SHA,
    event: 'pull_request',
    workflow: 'Ultron core verification',
    workflowRef: 'michaeljwilliams0123/Ultron.MW/.github/workflows/verify.yml@refs/pull/313/merge',
    workflowRunId: 123,
    workflowRunAttempt: 2,
    workflowRunUrl: RUN_URL,
    job: 'attested-receipt',
    verification: 'node scripts/verify.mjs',
    paidSpendAuthorizedUsd: 0,
  });
});

test('verification receipt fails closed on source drift and incomplete workflow provenance', () => {
  const base = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'michaeljwilliams0123/Ultron.MW',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_WORKFLOW: 'Ultron core verification',
    GITHUB_WORKFLOW_REF: 'michaeljwilliams0123/Ultron.MW/.github/workflows/verify.yml@refs/pull/313/merge',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_JOB: 'attested-receipt',
    SOURCE_SHA: SHA,
  };

  assert.throws(
    () => buildGitHubVerificationReceipt({ env: base, observedSha: 'c'.repeat(40) }),
    /checkout SHA does not match SOURCE_SHA/,
  );
  assert.throws(
    () => buildGitHubVerificationReceipt({ env: { ...base, GITHUB_WORKFLOW_REF: '' }, observedSha: SHA }),
    /GITHUB_WORKFLOW_REF is required/,
  );
  assert.throws(
    () => buildGitHubVerificationReceipt({ env: { ...base, GITHUB_REPOSITORY: 'other/repo' }, observedSha: SHA }),
    /unexpected GitHub repository/,
  );
});

test('core verification attests only a successful same-repository receipt with minimum write scope', async () => {
  const yml = await readFile(resolve(import.meta.dirname, '../.github/workflows/verify.yml'), 'utf8');

  assert.match(yml, /attested-receipt:/);
  assert.match(yml, /needs: test/);
  assert.match(yml, /needs\.test\.result == 'success'/);
  assert.match(yml, /pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(yml, /pull_request\.user\.login == 'michaeljwilliams0123'/);
  assert.match(yml, /id-token: write/);
  assert.match(yml, /attestations: write/);
  assert.match(yml, /artifact-metadata: write/);
  assert.match(yml, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/);
  assert.match(yml, /subject-path: artifacts\/github-verification-receipt\.json/);
  assert.match(yml, /steps\.attest\.outputs\.bundle-path/);
  assert.match(yml, /retention-days: 7/);
  assert.ok(
    yml.indexOf('node scripts/write-github-verification-receipt.mjs') < yml.indexOf('actions/attest@'),
    'the exact-source receipt must exist before GitHub signs its digest',
  );
});
