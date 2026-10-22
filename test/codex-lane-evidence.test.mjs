import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexCall, formatCodexCall,
  buildCodexClaim, buildCodexReceipt } from '../src/codex-call.mjs';
import { assessCodexLane, validateCodexClaimRecord } from '../src/codex-lane-evidence.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const CLAIM_COMMIT = 'c'.repeat(40);
const task = buildCodexCall({ issueNumber: 82, sourceSha: MAIN,
  objective: '/codex destiny-codex Inspect public author registry' });
const original = () => ({
  mainSha: MAIN, bindingFingerprint: task.bindingFingerprint,
  proposalText: formatCodexCall(task),
  pr: { number: 83, state: 'open', user: { login: 'github-actions[bot]' },
    title: '[Ultron Codex] destiny-codex · issue 82', body: formatCodexCall(task),
    head: { ref: 'ultron/issue-82', sha: HEAD,
      repo: { full_name: 'michaeljwilliams0123/Ultron.MW' } },
    base: { ref: 'main', repo: { full_name: 'michaeljwilliams0123/Ultron.MW' } } },
  issue: { number: 82, state: 'open', user: { login: 'michaeljwilliams0123' },
    title: '[Ultron PR] Create proposal',
    body: 'ULTRON_PR_V1\n' + task.request },
});
const url = 'https://github.com/michaeljwilliams0123/Ultron.MW/actions/runs/39829603706';
const run = (event, conclusion, options={}) => ({
  event, conclusion, status: 'completed', head_sha: HEAD,
  name: 'Ultron core verification', created_at: '2026-10-22T18:14:30Z',
  html_url: url, jobs: [], ...options,
});
const pass = () => run('pull_request', 'success', {
  jobs: [{ name: 'test', conclusion: 'success', status: 'completed', head_sha: HEAD }],
});
const trigger = { body: '/codex run destiny-codex',
  user: { login: 'michaeljwilliams0123' } };
const claim = buildCodexClaim(task, { headSha: HEAD,
  claimedAt: '2026-10-22T18:18:00.000Z' });
const receipt = buildCodexReceipt(task, { headSha: HEAD,
  claimHeadSha: CLAIM_COMMIT, completedAt: '2026-10-22T18:19:00.000Z',
  result: 'Inspected public registry' });

test('GitHub bot PR, verified proposal, route enrollment are not executor proof', () => {
  const result = assessCodexLane(original());
  assert.equal(result.executionState, 'not-observed');
  assert.equal(result.githubPrCheck, 'unobserved');
  assert.equal(result.signedWorkAccountAttested, false);
  assert.equal(result.completedOnDistinctAuthenticatedWorkAccount, false);
  assert.equal(result.mergeAccepted, false);
  assert.deepEqual(Object.keys(result.workReceiptPaths).sort(), ['claim', 'receipt']);
});
test('manual dispatch green never replaces PR exact-head workflow', () => {
  const result = assessCodexLane({
    ...original(), workflowDispatchRuns: [run('workflow_dispatch', 'success')],
  });
  assert.equal(result.githubExplicitDispatchPassed, true);
  assert.equal(result.githubPrCheck, 'unobserved');
  assert.equal(result.nextAction, 'obtain-current-head-pr-check');
});
test('PR action_required is distinct from passing the test job', () => {
  const result = assessCodexLane({
    ...original(), pullRequestRuns: [run('pull_request','action_required')],
    workflowDispatchRuns: [run('workflow_dispatch','success')],
  });
  assert.equal(result.githubPrCheck, 'owner-approval-required');
  assert.equal(result.nextAction, 'approve-trusted-pr-run-through-github');
});
test('successful current-head PR test preserves separate Work execution gap', () => {
  const result = assessCodexLane({
    ...original(), pullRequestRuns: [pass()], ownerComments: [trigger],
  });
  assert.equal(result.githubPrCheck, 'passed');
  assert.equal(result.executionState, 'not-observed');
  assert.equal(result.githubOwnerTriggerCount, 1);
  assert.equal(result.nextAction, 'await-or-investigate-named-work-event');
});
test('bot or wrong-author trigger is not treated as owner event', () => {
  const data = assessCodexLane({
    ...original(), pullRequestRuns: [pass()],
    ownerComments: [{...trigger, user:{login:'github-actions[bot]'}},
      {body:'/codex run mike-codex',user:trigger.user}],
  });
  assert.equal(data.githubOwnerTriggerCount, 0);
});
test('PR success requires completed actual test job for exact head', () => {
  for (const jobs of [[], [{ name:'test',status:'queued'}],
    [{ name:'test',status:'completed',conclusion:'failure' }],
    [{ name:'test',status:'completed',conclusion:'success',head_sha:MAIN }]]) {
    const result=assessCodexLane({ ...original(),pullRequestRuns:[
      run('pull_request','success',{ jobs })] });
    assert.equal(result.githubPrCheck,'job-proof-missing');
  }
});
test('wrong head and wrong event never yield current-head acceptance', () => {
  const result=assessCodexLane({ ...original(),pullRequestRuns:[
    run('pull_request','success',{head_sha: MAIN, jobs: pass().jobs}),
    run('workflow_dispatch','success',{jobs:pass().jobs})] });
  assert.equal(result.githubPrCheck,'unobserved');
});
test('incomplete claim always requires reconciliation rather than retry', () => {
  const result=assessCodexLane({
    ...original(),pullRequestRuns:[pass()],ownerComments:[trigger],claim,
  });
  assert.equal(result.replayDisposition,'reconcile-required');
  assert.equal(result.executionState,'claim-requires-reconciliation');
  assert.equal(result.nextAction,'reconcile-claimed-task-with-actual-executor');
});
test('existing v1 completion receipt remains transport-level, not account authentication', () => {
  const result=assessCodexLane({
    ...original(),pullRequestRuns:[pass()],claim,receipt,
  });
  assert.equal(result.replayDisposition,'already-completed');
  assert.equal(result.executionState,'completion-receipt-unattributed');
  assert.equal(result.signedWorkAccountAttested,false);
  assert.equal(result.mergeAccepted,false);
  assert.equal(result.nextAction,'independently-attest-work-account-and-review');
});
test('orphan receipt or spoofed claim cannot be accepted', () => {
  assert.throws(() => assessCodexLane({...original(),receipt}),/without earlier claim/);
  for(const modified of [
    {...claim,authorId:'mike-codex'},
    {...claim,taskDigest:MAIN},
    {...claim,attempts:2},
    {...claim,extra:'true'},
  ]) assert.throws(() => validateCodexClaimRecord(modified,task));
});
test('edited issue, wrong main, branch and binding fail admission before status', () => {
  const variants=[
    data=>{data.mainSha=HEAD;},
    data=>{data.bindingFingerprint='f'.repeat(64);},
    data=>{data.pr.head.ref='untrusted-branch';},
    data=>{data.issue.body+=' changed';},
  ];
  for (const edit of variants) {
    const data=original();edit(data);
    assert.throws(()=>assessCodexLane(data));
  }
});
test('dispatch without source provenance and fake run URLs do not become evidence',()=>{
  const result=assessCodexLane({ ...original(),pullRequestRuns:[
    run('pull_request','success',{html_url:'https://example.com/fake',jobs:pass().jobs})] });
  assert.equal(result.githubPrCheck,'passed');
  assert.equal(result.checkRunUrl,null);
  assert.equal(result.mergeAccepted,false);
});
