/**
 * GitHub transports events; it cannot attest the ChatGPT account operating a
 * task. This evaluator keeps the two evidence dimensions deliberately separate.
 * Never treat a public GitHub actor, workflow dispatch, or stable fingerprint
 * as a separate authenticated Mike/Destiny Work execution.
 */
import { validateCodexAdmission, parseCodexCall, codexReplayDisposition,
  validateCodexClaim, codexRecordPaths, DEFAULT_CODEX_POLICY,
  createCodexPolicy } from './codex-call.mjs';
const APPROVAL_EVENT = 'action_required';
const SHA = /^[a-f0-9]{40}$/;
const freeze = value => Object.freeze(value);

export const validateCodexClaimRecord = validateCodexClaim;

/** Prove a bounded, unmerged, first-parent chain from claim to tested head. */
function verifyExecutionChain(claimSha, testedHead, history) {
  if (testedHead === claimSha) {
    if (history !== undefined && (!Array.isArray(history) || history.length))
      throw Error('Unexpected Codex execution history for unchanged head');
    return;
  }
  if (!Array.isArray(history) || history.length < 1 || history.length > 100)
    throw Error('Codex execution ancestry incomplete');
  let parent = claimSha;
  for (const step of history) {
    if (!SHA.test(step?.sha || '') || !Array.isArray(step.parents) ||
        step.parents.length !== 1 || step.parents[0]?.sha !== parent ||
        step.sha === parent)
      throw Error('Codex execution ancestry has a fork, merge, or gap');
    parent = step.sha;
  }
  if (parent !== testedHead) throw Error('Codex execution ancestry omits tested head');
}

/** Validate exact-head Git history. Records must each be created once in their own commit. */
function requireSingleCreation(path, expectedParent, history, commit) {
  if (!Array.isArray(history) || history.length !== 1 ||
      !SHA.test(history[0]?.sha || '') ||
      commit?.sha !== history[0].sha ||
      !Array.isArray(commit?.parents) || commit.parents.length !== 1 ||
      commit.parents[0]?.sha !== expectedParent ||
      !Array.isArray(commit?.files) || commit.files.length !== 1 ||
      commit.files[0]?.filename !== path ||
      commit.files[0]?.status !== 'added')
    throw Error('Codex record Git history is missing, overwritten or inconsistent');
  return commit.sha;
}

export function verifyCodexRecordHistory(call, { claim, receipt, claimHistory,
  claimCommit, receiptHistory, receiptCommit, executionHistory } = {},
  policy = DEFAULT_CODEX_POLICY) {
  if (claim === undefined) {
    if (receipt !== undefined) throw Error('Orphan Codex receipt');
    return;
  }
  validateCodexClaim(claim, call, policy);
  const paths = codexRecordPaths(call, policy);
  const claimSha = requireSingleCreation(paths.claim, claim.headSha,
    claimHistory, claimCommit);
  if (receipt !== undefined) {
    if (receipt.claimHeadSha !== claimSha)
      throw Error('Codex receipt is not anchored to the claim creation commit');
    verifyExecutionChain(claimSha, receipt.headSha, executionHistory);
    if (Date.parse(receipt.completedAt) < Date.parse(claim.claimedAt))
      throw Error('Codex receipt predates the claim');
    requireSingleCreation(paths.receipt, receipt.headSha,
      receiptHistory, receiptCommit);
  }
}

function verifyPrWorkflow(prHead, runs = [], policy = DEFAULT_CODEX_POLICY) {
  if (!Array.isArray(runs)) throw Error('Workflow observations must be an array');
  const applicable = runs.filter(x => x?.event === 'pull_request' &&
    x.head_sha === prHead && x.name === policy.workflowName);
  const latest = [...applicable].sort((a,b) =>
    (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))[0];
  if (!latest) return freeze({ state: 'unobserved', workflowRunUrl: null });
  if (latest.conclusion === APPROVAL_EVENT)
    return freeze({ state: 'owner-approval-required',
      workflowRunUrl: safeRunUrl(latest.html_url, policy) });
  if (latest.status !== 'completed')
    return freeze({ state: 'pending', workflowRunUrl: safeRunUrl(latest.html_url, policy) });
  if (latest.conclusion !== 'success')
    return freeze({ state: 'failed', workflowRunUrl: safeRunUrl(latest.html_url, policy) });
  const verifiedUrl = safeRunUrl(latest.html_url, policy);
  if (!verifiedUrl) return freeze({ state: 'run-proof-missing', workflowRunUrl: null });
  const jobs = latest.jobs;
  if (!Array.isArray(jobs) || jobs.length < 1 ||
      !jobs.some(x => x?.name === policy.jobName && x.status === 'completed' &&
        x.conclusion === 'success' && x.head_sha === prHead))
    return freeze({ state: 'job-proof-missing',
      workflowRunUrl: safeRunUrl(latest.html_url, policy) });
  return freeze({ state: 'passed', workflowRunUrl: safeRunUrl(latest.html_url, policy) });
}
function safeRunUrl(url, policy = DEFAULT_CODEX_POLICY) {
  const prefix = 'https://github.com/' + policy.repository + '/actions/runs/';
  return typeof url === 'string' && url.startsWith(prefix) &&
    /^[0-9]+$/.test(url.slice(prefix.length)) ? url : null;
}
function countOwnerTriggers(comments, author, policy = DEFAULT_CODEX_POLICY) {
  if (!Array.isArray(comments)) throw Error('Comments must be an array');
  return comments.filter(x => x?.user?.login === policy.owner &&
    x?.body === '/codex run ' + author).length;
}

/**
 * Input GitHub records MUST have been retrieved from the exact observed PR
 * head and separately from trusted main. Callers must recheck PR/head after
 * reading. This is a status report, never mutation or account attestation.
 */
export function assessCodexLane({
  pr, issue, proposalText, mainSha, bindingFingerprint,
  pullRequestRuns = [], workflowDispatchRuns = [],
  ownerComments = [], claim, receipt,
  claimHistory, claimCommit, receiptHistory, receiptCommit, executionHistory,
  policy = DEFAULT_CODEX_POLICY,
} = {}) {
  policy = createCodexPolicy(policy);
  if (!SHA.test(mainSha || '')) throw Error('Current main SHA was not verified');
  const envelope = parseCodexCall(pr?.body, policy);
  const sourceStale = mainSha !== envelope.sourceSha;
  // Read-only classification only. The real executor MUST require actual mainSha.
  const call = validateCodexAdmission({
    pr, issue, proposalText,
    mainSha: sourceStale ? envelope.sourceSha : mainSha,
    bindingFingerprint, policy,
  });
  const paths = codexRecordPaths(call, policy);
  if (claim !== undefined) verifyCodexRecordHistory(call, {
    claim, receipt, claimHistory, claimCommit, receiptHistory, receiptCommit,
    executionHistory,
  }, policy);
  if (receipt !== undefined && claim === undefined)
    throw Error('Completion receipt without earlier claim is not sufficient');
  const replay = codexReplayDisposition(call, {
    ...(claim === undefined ? {} : { claim }),
    ...(receipt === undefined ? {} : { receipt }),
  }, policy);
  const checks = verifyPrWorkflow(pr.head.sha, pullRequestRuns, policy);
  if (!Array.isArray(workflowDispatchRuns)) throw Error('Dispatch evidence invalid');
  const dispatchedGreen = workflowDispatchRuns.some(x =>
    x?.event === 'workflow_dispatch' && x.head_sha === pr.head.sha &&
    x.name === policy.workflowName && x.status === 'completed' &&
    x.conclusion === 'success');
  const triggerCount = countOwnerTriggers(ownerComments, call.authorId, policy);
  const executionState = replay === 'already-completed'
    ? 'completion-receipt-unattributed'
    : replay === 'reconcile-required'
      ? 'claim-requires-reconciliation'
      : 'not-observed';
  const nextAction = sourceStale
    ? 'supersede-stale-task-with-new-owner-issue-from-current-main'
    : checks.state === 'owner-approval-required'
    ? 'approve-trusted-pr-run-through-github'
    : checks.state !== 'passed'
      ? 'obtain-current-head-pr-check'
      : replay === 'already-completed'
        ? 'independently-attest-work-account-and-review'
        : replay === 'reconcile-required'
          ? 'reconcile-claimed-task-with-actual-executor'
          : triggerCount > 1
            ? 'investigate-duplicate-owner-triggers-without-replay'
            : triggerCount
              ? 'verify-work-route-enabled-and-investigate-event'
            : 'request-once-through-owner-comment-if-authorized';
  return freeze({
    kind: 'ultron.codex.lane-evidence.v1',
    taskId: call.taskId, issueNumber: call.issueNumber, prNumber: pr.number,
    authorId: call.authorId, authorFingerprint: call.authorFingerprint,
    bindingFingerprint: call.bindingFingerprint,
    sourceSha: call.sourceSha, observedMainSha: mainSha, prHeadSha: pr.head.sha,
    sourceAdmission: sourceStale ? 'stale-current-main' : 'current',
    githubPrCheck: checks.state, checkRunUrl: checks.workflowRunUrl,
    githubExplicitDispatchPassed: dispatchedGreen,
    githubOwnerTriggerCount: triggerCount,
    replayDisposition: replay, executionState,
    workRouteAvailability: 'not-observable-from-github',
    signedWorkAccountAttested: false,
    completedOnDistinctAuthenticatedWorkAccount: false,
    workReceiptPaths: paths, nextAction, mergeAccepted: false,
    limitations: 'GitHub transport is not independent ChatGPT Work account proof',
  });
}
