/**
 * GitHub transports events; it cannot attest the ChatGPT account operating a
 * task. This evaluator keeps the two evidence dimensions deliberately separate.
 * Never treat a public GitHub actor, workflow dispatch, or stable fingerprint
 * as a separate authenticated Mike/Destiny Work execution.
 */
import { validateCodexAdmission, codexReplayDisposition,
  validateCodexReceipt, codexRecordPaths } from './codex-call.mjs';
const MAIN_WORKFLOW = 'Ultron core verification';
const APPROVAL_EVENT = 'action_required';
const SHA = /^[a-f0-9]{40}$/;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const freeze = value => Object.freeze(value);
const same = (a, b) => a === b;

/** Verify task claims on the branch without treating a claim as completed work. */
export function validateCodexClaimRecord(claim, call) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
      Object.keys(claim).sort().join(',') !==
        'attempts,authorId,bindingFingerprint,claimedAt,headSha,schema,sourceSha,status,taskDigest,taskId' ||
      claim.schema !== 'ultron.codex.claim.v1' || claim.taskId !== call.taskId ||
      claim.taskDigest !== call.digest || claim.authorId !== call.authorId ||
      claim.bindingFingerprint !== call.bindingFingerprint ||
      claim.sourceSha !== call.sourceSha || !SHA.test(claim.headSha || '') ||
      !ISO_TIME.test(claim.claimedAt || '') ||
      !Number.isFinite(Date.parse(claim.claimedAt)) ||
      claim.status !== 'claimed' || claim.attempts !== 1)
    throw Error('Invalid or conflicting Codex claim; reconcile before replay');
  return freeze({ ...claim });
}

function verifyPrWorkflow(prHead, runs = []) {
  if (!Array.isArray(runs)) throw Error('Workflow observations must be an array');
  const applicable = runs.filter(x => x?.event === 'pull_request' &&
    x.head_sha === prHead && x.name === MAIN_WORKFLOW);
  const latest = [...applicable].sort((a,b) =>
    (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0))[0];
  if (!latest) return freeze({ state: 'unobserved', workflowRunUrl: null });
  if (latest.conclusion === APPROVAL_EVENT)
    return freeze({ state: 'owner-approval-required',
      workflowRunUrl: safeRunUrl(latest.html_url) });
  if (latest.status !== 'completed')
    return freeze({ state: 'pending', workflowRunUrl: safeRunUrl(latest.html_url) });
  if (latest.conclusion !== 'success')
    return freeze({ state: 'failed', workflowRunUrl: safeRunUrl(latest.html_url) });
  const jobs = latest.jobs;
  if (!Array.isArray(jobs) || jobs.length < 1 ||
      !jobs.some(x => x?.name === 'test' && x.status === 'completed' &&
        x.conclusion === 'success' && (!x.head_sha || x.head_sha === prHead)))
    return freeze({ state: 'job-proof-missing',
      workflowRunUrl: safeRunUrl(latest.html_url) });
  return freeze({ state: 'passed', workflowRunUrl: safeRunUrl(latest.html_url) });
}
function safeRunUrl(url) {
  if (typeof url !== 'string' ||
      !/^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/actions\/runs\/[0-9]+$/.test(url))
    return null;
  return url;
}
function countOwnerTriggers(comments, author) {
  if (!Array.isArray(comments)) throw Error('Comments must be an array');
  return comments.filter(x => x?.user?.login === 'michaeljwilliams0123' &&
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
} = {}) {
  const call = validateCodexAdmission({
    pr, issue, proposalText, mainSha, bindingFingerprint,
  });
  const paths = codexRecordPaths(call);
  if (claim !== undefined) validateCodexClaimRecord(claim, call);
  if (receipt !== undefined) {
    validateCodexReceipt(receipt, call);
    if (claim === undefined)
      throw Error('Completion receipt without earlier claim is not sufficient');
  }
  const replay = codexReplayDisposition(call, {
    ...(claim === undefined ? {} : { claim }),
    ...(receipt === undefined ? {} : { receipt }),
  });
  const checks = verifyPrWorkflow(pr.head.sha, pullRequestRuns);
  if (!Array.isArray(workflowDispatchRuns)) throw Error('Dispatch evidence invalid');
  const dispatchedGreen = workflowDispatchRuns.some(x =>
    x?.event === 'workflow_dispatch' && x.head_sha === pr.head.sha &&
    x.name === MAIN_WORKFLOW && x.status === 'completed' &&
    x.conclusion === 'success');
  const triggerCount = countOwnerTriggers(ownerComments, call.authorId);
  const executionState = replay === 'already-completed'
    ? 'completion-receipt-unattributed'
    : replay === 'reconcile-required'
      ? 'claim-requires-reconciliation'
      : 'not-observed';
  const nextAction = checks.state === 'owner-approval-required'
    ? 'approve-trusted-pr-run-through-github'
    : checks.state !== 'passed'
      ? 'obtain-current-head-pr-check'
      : replay === 'already-completed'
        ? 'independently-attest-work-account-and-review'
        : replay === 'reconcile-required'
          ? 'reconcile-claimed-task-with-actual-executor'
          : triggerCount
            ? 'await-or-investigate-named-work-event'
            : 'request-once-through-owner-comment-if-authorized';
  return freeze({
    kind: 'ultron.codex.lane-evidence.v1',
    taskId: call.taskId, issueNumber: call.issueNumber, prNumber: pr.number,
    authorId: call.authorId, authorFingerprint: call.authorFingerprint,
    bindingFingerprint: call.bindingFingerprint,
    sourceSha: call.sourceSha, prHeadSha: pr.head.sha,
    githubPrCheck: checks.state, checkRunUrl: checks.workflowRunUrl,
    githubExplicitDispatchPassed: dispatchedGreen,
    githubOwnerTriggerCount: triggerCount,
    replayDisposition: replay, executionState,
    signedWorkAccountAttested: false,
    completedOnDistinctAuthenticatedWorkAccount: false,
    workReceiptPaths: paths, nextAction, mergeAccepted: false,
    limitations: 'GitHub transport is not independent ChatGPT Work account proof',
  });
}
