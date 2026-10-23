import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexCall, formatCodexCall, validateCodexAdmission,
  buildCodexClaim, buildCodexReceipt } from '../src/codex-call.mjs';
import { assessCodexLane, validateCodexClaimRecord,
  validateCodexLaneReadback,
  validateCodexWorkflowInventory } from '../src/codex-lane-evidence.mjs';

const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const CLAIM_COMMIT = 'c'.repeat(40);
const RECEIPT_COMMIT = 'd'.repeat(40);
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
  id:39829603706,event, conclusion, status: 'completed', head_sha: HEAD,
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
const receipt = buildCodexReceipt(task, { headSha: CLAIM_COMMIT,
  claimHeadSha: CLAIM_COMMIT, completedAt: '2026-10-22T18:19:00.000Z',
  result: 'Inspected public registry' });
const paths = {claim: 'docs/codex/claims/' + task.taskId + '.json',
  receipt: 'docs/codex/receipts/' + task.taskId + '.json'};
const provenance = () => ({
  claimHistory: [{sha: CLAIM_COMMIT}],
  claimCommit: {sha: CLAIM_COMMIT, parents: [{sha: HEAD}],
    files: [{filename: paths.claim, status: 'added'}]},
  receiptHistory: [{sha: RECEIPT_COMMIT}],
  receiptCommit: {sha: RECEIPT_COMMIT, parents: [{sha: CLAIM_COMMIT}],
    files: [{filename: paths.receipt, status: 'added'}]},
});

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
  assert.equal(result.nextAction, 'verify-work-route-enabled-and-investigate-event');
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
    ...provenance(),
  });
  assert.equal(result.replayDisposition,'reconcile-required');
  assert.equal(result.executionState,'claim-requires-reconciliation');
  assert.equal(result.nextAction,'reconcile-claimed-task-with-actual-executor');
});
test('existing v1 completion receipt remains transport-level, not account authentication', () => {
  const result=assessCodexLane({
    ...original(),pullRequestRuns:[pass()],claim,receipt,
    ...provenance(),
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
test('edited issue, branch and binding fail admission before status', () => {
  const variants=[
    data=>{data.bindingFingerprint='f'.repeat(64);},
    data=>{data.pr.head.ref='untrusted-branch';},
    data=>{data.issue.body+=' changed';},
  ];
  for (const edit of variants) {
    const data=original();edit(data);
    assert.throws(()=>assessCodexLane(data));
  }
});
test('stale main is reported as a blocked request rather than executed', () => {
  const result = assessCodexLane({...original(), mainSha: 'e'.repeat(40),
    pullRequestRuns: [pass()], ownerComments: [trigger]});
  assert.equal(result.sourceAdmission, 'stale-current-main');
  assert.equal(result.githubPrCheck, 'passed');
  assert.equal(result.nextAction,
    'supersede-stale-task-with-new-owner-issue-from-current-main');
  assert.equal(result.mergeAccepted, false);
});
test('reject forged creation ancestry, altered claim link and overwritten records', () => {
  const good = {...original(),claim,receipt,...provenance()};
  const cases = [
    {claimHistory:[{sha:'e'.repeat(40)}]},
    {claimHistory:[]},
    {claimCommit:{...good.claimCommit,parents:[{sha:MAIN}]}},
    {claimCommit:{...good.claimCommit,files:[{filename:paths.claim,status:'modified'}]}},
    {claimCommit:{...good.claimCommit,files:[{filename:paths.claim,status:'added'},
      {filename:'src/other.mjs',status:'modified'}]}},
    {receiptCommit:{...good.receiptCommit,parents:[{sha:MAIN}]}},
    {receiptHistory:[{sha:RECEIPT_COMMIT},{sha:CLAIM_COMMIT}]},
    {receipt:{...receipt,claimHeadSha:'e'.repeat(40)}},
    {receipt:{...receipt,completedAt:'2026-10-22T18:17:00.000Z'}},
  ];
  for (const delta of cases)
    assert.throws(()=>assessCodexLane({...good,...delta}));
  assert.throws(()=>assessCodexLane({...original(),claim}),/Git history/);
  assert.throws(()=>assessCodexLane({...original(),claim,receipt}),/Git history/);
});

test('dispatch without source provenance and fake run URLs do not become evidence',()=>{
  const result=assessCodexLane({ ...original(),pullRequestRuns:[
    run('pull_request','success',{html_url:'https://example.com/fake',jobs:pass().jobs})] });
  assert.equal(result.githubPrCheck,'run-proof-missing');
  assert.equal(result.checkRunUrl,null);
  assert.equal(result.mergeAccepted,false);
});

// Universal policy and linear ancestry regression cases. Added before implementation.
import { createCodexPolicy } from '../src/codex-call.mjs';

const portableAuthor = {
  id: 'agent2-codex', name: 'Agent Codex', aliases: ['AgentAlias'],
  fingerprint: '8'.repeat(64),
  binding: {status:'enrolled', fingerprint:'9'.repeat(64)},
};
const portableConfig = {
  repository: 'sample-org/portable-repo', owner: 'trusted-maintainer',
  baseBranch: 'release', branchPrefix: 'agent/task-',
  prTitlePrefix: '[Portable Codex] ', issueTitle: '[Portable] Request',
  issueMarker: 'PORTABLE_REQUEST_V1',
  trustedPrActors: ['github-actions[bot]'],
  workflowName: 'Cross-repo verify', jobName: 'integration',
  authors: [portableAuthor],
};

test('portable policy admits a separately registered author and different repository', () => {
  const policy = createCodexPolicy(portableConfig);
  const custom = buildCodexCall({issueNumber:7,sourceSha:MAIN,
    objective:'/codex agent2-codex Read public docs',policy});
  const aliasCall = buildCodexCall({issueNumber:9,sourceSha:MAIN,
    objective:'/codex AgentAlias Read public docs',policy});
  assert.equal(aliasCall.authorId,'agent2-codex');
  const proposalText = formatCodexCall(custom,policy);
  const data = {
    policy, mainSha:MAIN, bindingFingerprint:custom.bindingFingerprint,
    proposalText,
    issue: {number:7,state:'open',user:{login:'trusted-maintainer'},
      title:'[Portable] Request',body:'PORTABLE_REQUEST_V1\n'+custom.request},
    pr: {number:8,state:'open',user:{login:'github-actions[bot]'},
      title:'[Portable Codex] agent2-codex · issue 7',body:proposalText,
      head:{ref:'agent/task-7',sha:HEAD,repo:{full_name:'sample-org/portable-repo'}},
      base:{ref:'release',repo:{full_name:'sample-org/portable-repo'}}},
    pullRequestRuns:[{id:123,event:'pull_request',name:'Cross-repo verify',
      head_sha:HEAD,status:'completed',conclusion:'success',
      created_at:'2026-10-23T12:00:00Z',
      html_url:'https://github.com/sample-org/portable-repo/actions/runs/123',
      jobs:[{name:'integration',status:'completed',conclusion:'success',head_sha:HEAD}]}],
    ownerComments:[{body:'/codex run agent2-codex',
      user:{login:'trusted-maintainer'}}],
  };
  const result=assessCodexLane(data);
  assert.equal(result.githubPrCheck,'passed');
  assert.equal(result.githubOwnerTriggerCount,1);
  assert.equal(result.sourceAdmission,'current');
  assert.equal(result.signedWorkAccountAttested,false);
  assert.equal(result.mergeAccepted,false);
  assert.equal(result.checkRunUrl,'https://github.com/sample-org/portable-repo/actions/runs/123');
  assert.throws(()=>assessCodexLane({...data,policy:undefined}));
});

test('portable policy rejects ambiguous author registries and unbounded identities', () => {
  for (const change of [
    {unknown: true},
    {repository:'../unsafe'},
    {baseBranch:'../main'},
    {workflowName:'x\\nspoof'},
    {trustedPrActors:['sample-org','sample-org']},
    {authors:[portableAuthor,{...portableAuthor,id:'second-agent'}]},
    {authors:[portableAuthor,{...portableAuthor,id:'second-agent',
      fingerprint:'a'.repeat(64),binding:{status:'enrolled',fingerprint:'b'.repeat(64)},
      aliases:['agent']}]},
    {authors:[portableAuthor,{...portableAuthor,id:'second-agent',
      name:'Another Agent', aliases:['another-agent'],
      binding:{status:'enrolled',fingerprint:'b'.repeat(64)}}]},
    {authors:[{...portableAuthor,binding:{status:'enrolled',
      fingerprint:'9'.repeat(64),unexpected:{nested:'unbounded'}}}]},
    {authors:[{...portableAuthor,sessionObservation:{
      kind:'work-session-observation',accountAuthenticated:true,
      unexpected:'untrusted'}}]},
    {authors:[{...portableAuthor,binding:{status:'not-enrolled',
      fingerprint:{nested:'secret'}}}]},

  ]) assert.throws(()=>createCodexPolicy({...portableConfig,...change}));
});

test('receipt Git creation must linearly follow claim creation',()=>{
  const good={...original(),claim,receipt:{...receipt,headSha:CLAIM_COMMIT},
    ...provenance()};
  good.receiptCommit={...good.receiptCommit,parents:[{sha:CLAIM_COMMIT}]};
  assert.equal(assessCodexLane(good).replayDisposition,'already-completed');
  for(const forged of [
    {receiptCommit:{...good.receiptCommit,parents:[{sha:HEAD}]}},
    {receipt:{...good.receipt,headSha:HEAD}},
    {receiptCommit:{...good.receiptCommit,parents:[{sha:HEAD},{sha:CLAIM_COMMIT}]}},
  ]) assert.throws(()=>assessCodexLane({...good,...forged}));
});

test('duplicate owner triggers require reconciliation, not another trigger',()=>{
  const result=assessCodexLane({...original(),pullRequestRuns:[pass()],
    ownerComments:[trigger,trigger]});
  assert.equal(result.githubOwnerTriggerCount,2);
  assert.equal(result.nextAction,'investigate-duplicate-owner-triggers-without-replay');
});

test('execution can update product source after claim with verified first-parent ancestry',()=>{
  const testedHead='e'.repeat(40);
  const base={...original(),claim,
    receipt:{...receipt,headSha:testedHead},
    ...provenance(),
    executionHistory:[{sha:testedHead,parents:[{sha:CLAIM_COMMIT}]}]};
  base.receiptCommit={...base.receiptCommit,parents:[{sha:testedHead}]};
  assert.equal(assessCodexLane(base).replayDisposition,'already-completed');
  assert.throws(()=>assessCodexLane({...base,executionHistory:undefined}));
  assert.throws(()=>assessCodexLane({...base,
    executionHistory:[{sha:testedHead,parents:[{sha:HEAD}]}]}));
  assert.throws(()=>assessCodexLane({...base,
    executionHistory:[{sha:testedHead,parents:[{sha:CLAIM_COMMIT},{sha:HEAD}]}]}));
  assert.throws(()=>assessCodexLane({...base,receiptCommit:{
    ...base.receiptCommit,parents:[{sha:CLAIM_COMMIT}]}}));
});

test('organization-owned repositories admit independent named human request owners',()=>{
  const policy=createCodexPolicy({...portableConfig,owner:'trusted-maintainer',
    trustedPrActors:['github-actions[bot]']});
  const custom=buildCodexCall({issueNumber:7,sourceSha:MAIN,
    objective:'/codex agent2-codex Read public docs',policy});
  const proposalText=formatCodexCall(custom,policy);
  const data={
    policy, mainSha:MAIN,bindingFingerprint:custom.bindingFingerprint,proposalText,
    issue:{number:7,state:'open',user:{login:'trusted-maintainer'},
      title:policy.issueTitle,body:policy.issueMarker+'\n'+custom.request},
    pr:{number:8,state:'open',user:{login:'github-actions[bot]'},
      title:policy.prTitlePrefix+'agent2-codex · issue 7',body:proposalText,
      head:{ref:policy.branchPrefix+'7',sha:HEAD,repo:{full_name:policy.repository}},
      base:{ref:policy.baseBranch,repo:{full_name:policy.repository}}},
  };
  assert.deepEqual(validateCodexAdmission(data),custom);
  assert.throws(()=>validateCodexAdmission({...data,issue:{...data.issue,
    user:{login:'sample-org'}}}));
  assert.throws(()=>createCodexPolicy({...portableConfig,repository:'sample-org/..'}));
});

test('workflow proof rejects malformed ordering, mismatched URL and truncated inventory',()=>{
  assert.throws(()=>assessCodexLane({...original(),pullRequestRuns:[
    pass(),run('pull_request','failure',{id:39829603707,created_at:'not-a-time'})]}),
  /workflow run identity/i);
  const mismatch=assessCodexLane({...original(),pullRequestRuns:[
    {...pass(),id:123}]});
  assert.equal(mismatch.githubPrCheck,'run-proof-missing');
  assert.throws(()=>validateCodexWorkflowInventory({total_count:2,
    workflow_runs:[pass()]}),/incomplete/i);
  assert.equal(validateCodexWorkflowInventory({total_count:1,
    workflow_runs:[pass()]}).length,1);
});

test('final readback revalidates every admitted PR, Issue and source field',()=>{
  const before=original();
  const input={beforePr:before.pr,afterPr:structuredClone(before.pr),
    beforeIssue:before.issue,afterIssue:structuredClone(before.issue),
    beforeMainSha:MAIN,afterMainSha:MAIN,proposalText:before.proposalText,
    bindingFingerprint:before.bindingFingerprint};
  assert.equal(validateCodexLaneReadback(input).digest,task.digest);
  const edits=[
    value=>{value.afterPr.title='changed';},
    value=>{value.afterPr.state='closed';},
    value=>{value.afterPr.base.ref='other';},
    value=>{value.afterPr.head.ref='other';},
    value=>{value.afterPr.user.login='outsider';},
    value=>{value.afterIssue.title='changed';},
    value=>{value.afterIssue.user.login='outsider';},
    value=>{value.afterMainSha=HEAD;},
  ];
  for(const edit of edits){
    const value=structuredClone(input);edit(value);
    assert.throws(()=>validateCodexLaneReadback(value));
  }
});
