import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGithubWorkflowPayload,
  compareGithubRun,
  admitGithubDelivery
} from '../cloud/hatchable/lib/hf-github-receipts.js';
import { buildGitHubVerificationReceipt } from '../scripts/write-github-verification-receipt.mjs';

const REPO = 'michaeljwilliams0123/Ultron.MW';
// Current identity is canonical; retired organization aliases must fail closed.
const ATTESTATION_REPO = 'michaeljwilliams0123/Ultron.MW';
const SHA = 'b'.repeat(40);
const ACTORS = [
  { login: 'michaeljwilliams0123', id: 308995719 },
  { login: 'michaeljwilliams0123ultron', id: 354634860 }
];
const run = (changes = {}) => ({
  id: 42816723356,
  run_attempt: 1,
  path: '.github/workflows/c06-owner-model-release.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_sha: SHA,
  head_branch: 'main',
  repository: { full_name: REPO, private: false },
  actor: ACTORS[0],
  ...changes
});
const payload = (r = run(), changes = {}) => ({
  action: 'completed',
  repository: { full_name: REPO, private: false },
  workflow_run: r,
  ...changes
});

for (const actor of ACTORS) {
  test('GitHub receipt admission trusts ' + actor.login + ' only with exact ID and canonical repo', () => {
    const accepted = validateGithubWorkflowPayload(payload(run({ actor })));
    assert.equal(accepted.sourceSha, SHA);
    assert.equal(accepted.workflowKey, 'c06');
  });
}
const invalidRuns = [
  ['mismatched primary actor ID', { actor: { login: ACTORS[0].login, id: ACTORS[1].id } }],
  ['mismatched Ultron actor ID', { actor: { login: ACTORS[1].login, id: ACTORS[0].id } }],
  ['missing actor ID', { actor: { login: ACTORS[0].login } }],
  ['bot actor', { actor: { login: 'github-actions[bot]', id: 41898282 } }],
  ['retired repository', { repository: { full_name: 'Ultron-MW/Ultron.MW', private: false } }],
  ['foreign repository', { repository: { full_name: 'attacker/Ultron.MW', private: false } }],
  ['private repository', { repository: { full_name: REPO, private: true } }],
  ['untrusted branch', { head_branch: 'transfer/unreviewed' }],
  ['pull request event', { event: 'pull_request_target' }],
  ['uncompleted run', { status: 'in_progress' }],
  ['unlisted workflow', { path: '.github/workflows/other.yml' }],
  ['malformed source SHA', { head_sha: 'main' }],
  ['zero run ID', { id: 0 }],
  ['zero run attempt', { run_attempt: 0 }]
];
for (const [description, change] of invalidRuns) {
  test('GitHub receipt admission rejects ' + description, () => {
    assert.throws(() => validateGithubWorkflowPayload(payload(run(change))), /untrusted-github-workflow/);
  });
}
test('GitHub receipt rejects a retired repository in the outer webhook envelope', () => {
  assert.throws(() => validateGithubWorkflowPayload(payload(run(), {
    repository: { full_name: 'Ultron-MW/Ultron.MW', private: false }
  })), /untrusted-github-workflow/);
});
test('Independent readback detects changed attempt, SHA, actor and outcome', () => {
  const expected = validateGithubWorkflowPayload(payload());
  const mutations = [
    { run_attempt: 2 }, { head_sha: 'c'.repeat(40) },
    { actor: ACTORS[1] }, { conclusion: 'failure' },
    { repository: { full_name: 'attacker/Ultron.MW', private: false } }
  ];
  for (const change of mutations) {
    const result = compareGithubRun(expected, run(change));
    assert.equal(result.verified, false, JSON.stringify(change));
  }
});
test('Same receipt delivery is idempotent with exactly one durable row', async () => {
  let row = null, inserts = 0;
  const db = { async query(sql, args) {
    if (sql.includes('INSERT INTO hf_github_receipts')) {
      inserts++;
      if (row) return { rows: [] };
      row = {
        id: 4, delivery_id: args[0], run_id: args[1],
        run_attempt: args[2], workflow_key: args[3],
        source_sha: args[4], conclusion: args[5],
        payload_sha256: args[6], state: 'pending'
      };
      return { rows: [row] };
    }
    if (sql.includes('SELECT id,delivery_id')) return { rows: row ? [row] : [] };
    throw Error('unexpected SQL');
  }};
  const event = validateGithubWorkflowPayload(payload());
  const args = {
    db, event,
    deliveryId: '00000000-0000-4000-8000-000000000370',
    payloadSha256: 'a'.repeat(64)
  };
  assert.equal((await admitGithubDelivery(args)).created, true);
  assert.equal((await admitGithubDelivery(args)).created, false);
  assert.equal(inserts, 2);
  await assert.rejects(
    admitGithubDelivery({ ...args, payloadSha256: 'b'.repeat(64) }),
    /delivery-id-conflict/
  );
});
test('No receipt database write occurs for invalid delivery or payload hash', async () => {
  let queried = false;
  const db = { async query() { queried = true; throw Error('should not query'); } };
  const event = validateGithubWorkflowPayload(payload());
  await assert.rejects(admitGithubDelivery({
    db, event, deliveryId: 'not-a-uuid', payloadSha256: 'a'.repeat(64)
  }), /untrusted-github-workflow/);
  await assert.rejects(admitGithubDelivery({
    db, event, deliveryId: '00000000-0000-4000-8000-000000000370', payloadSha256: 'invalid'
  }), /untrusted-github-workflow/);
  assert.equal(queried, false);
});

const receiptEnv = (changes = {}) => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: ATTESTATION_REPO,
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_WORKFLOW: 'Ultron core verification',
  GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/verify.yml@refs/pull/372/merge',
  GITHUB_RUN_ID: '42816723356',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_JOB: 'attested-receipt',
  SOURCE_SHA: SHA,
  ...changes
});
test('Attested receipt pins canonical source and $0 incremental spend', () => {
  const receipt = buildGitHubVerificationReceipt({ env: receiptEnv(), observedSha: SHA });
  assert.equal(receipt.repository, ATTESTATION_REPO);
  assert.equal(receipt.sourceSha, SHA);
  assert.equal(receipt.paidSpendAuthorizedUsd, 0);
  assert.equal(receipt.workflowRunUrl, 'https://github.com/' + ATTESTATION_REPO + '/actions/runs/42816723356');
});
const badEnvs = [
  ['retired repository', { GITHUB_REPOSITORY: 'Ultron-MW/Ultron.MW' }],
  ['bot owner alias', { GITHUB_REPOSITORY: 'michaeljwilliams0123ultron/Ultron.MW' }],
  ['untrusted workflow', { GITHUB_WORKFLOW: 'Unapproved Test' }],
  ['missing job', { GITHUB_JOB: 'test' }],
  ['wrong event', { GITHUB_EVENT_NAME: 'pull_request_target' }],
  ['untrusted workflow repository', { GITHUB_WORKFLOW_REF: 'attacker/Ultron.MW/.github/workflows/verify.yml@refs/pull/372/merge' }],
  ['untrusted workflow path', { GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/unknown.yml@refs/pull/372/merge' }],
  ['unauthorized feature ref', { GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/verify.yml@refs/heads/feature' }],
  ['pull request impersonating a main push', { GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/verify.yml@refs/heads/main' }],
  ['pull request using an invalid zero PR number', { GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/verify.yml@refs/pull/0/merge' }],
  ['workflow ref with appended untrusted suffix', { GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/verify.yml@refs/pull/372/merge/extra' }],
  ['arbitrary forged workflow suffix', { GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/verify.yml@evil-ref' }],
  ['invalid run number', { GITHUB_RUN_ID: '0' }],
  ['invalid attempt number', { GITHUB_RUN_ATTEMPT: '-1' }],
  ['invalid source SHA', { SOURCE_SHA: 'main' }],
  ['not a GitHub Actions runner', { GITHUB_ACTIONS: 'false' }]
];
for (const [description, change] of badEnvs) {
  test('Attested receipt rejects ' + description, () => {
    assert.throws(() => buildGitHubVerificationReceipt({
      env: receiptEnv(change), observedSha: SHA
    }));
  });
}
test('Attested receipt accepts exact main ref on push, not a pull request ref on push', () => {
  const result = buildGitHubVerificationReceipt({
    env: receiptEnv({
      GITHUB_EVENT_NAME: 'push',
      GITHUB_WORKFLOW_REF: ATTESTATION_REPO + '/.github/workflows/verify.yml@refs/heads/main'
    }),
    observedSha: SHA
  });
  assert.equal(result.event, 'push');
  assert.throws(() => buildGitHubVerificationReceipt({
    env: receiptEnv({ GITHUB_EVENT_NAME: 'push' }),
    observedSha: SHA
  }), /unexpected GitHub workflow ref/);
});
test('Attested receipt rejects exact-source mismatch', () => {
  assert.throws(() => buildGitHubVerificationReceipt({
    env: receiptEnv(), observedSha: 'c'.repeat(40)
  }), /checkout SHA does not match SOURCE_SHA/);
});
