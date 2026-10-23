#!/usr/bin/env node
/** GitHub-only, read-only evidence probe: no secrets or task contents printed. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCodexCall, codexRecordPaths } from '../src/codex-call.mjs';
import { assessCodexLane, validateCodexLaneReadback,
  validateCodexWorkflowInventory } from '../src/codex-lane-evidence.mjs';
import { resolveCodexAuthor } from '../docs/core/codex-authors.mjs';
const exec = promisify(execFile);
const REPO = 'michaeljwilliams0123/Ultron.MW';
const ROOT = 'repos/' + REPO;
const ID = /^[1-9][0-9]{0,7}$/;
const SHA = /^[a-f0-9]{40}$/;
async function get(path, { optional = false } = {}) {
  try {
    const { stdout } = await exec('gh', [
      'api', '--hostname', 'github.com', '--method', 'GET', path
    ], { windowsHide: true, maxBuffer: 2_000_000, timeout: 15000 });
    return JSON.parse(stdout);
  } catch (error) {
    if (optional && /HTTP 404\b/.test(String(error.stderr || ''))) return null;
    throw Error('GitHub evidence fetch failed; no positive status inferred');
  }
}
async function recordHistory(path, head) {
  const history = await get(ROOT + '/commits?sha=' +
    encodeURIComponent(head) + '&path=' + encodeURIComponent(path) +
    '&per_page=2');
  if (!Array.isArray(history) || history.length !== 1)
    throw Error('Codex record history unavailable or not create-only');
  const commit = await get(ROOT + '/commits/' + history[0].sha);
  return { history: history.map(({sha}) => ({sha})), commit };
}
/** Read-only, complete and bounded first-parent proof for intervening code commits. */
async function executionChain(claimSha, testedHead) {
  if (testedHead === claimSha) return undefined;
  if (!SHA.test(claimSha || '') || !SHA.test(testedHead || ''))
    throw Error('Cannot verify Codex execution ancestry');
  const compare = await get(ROOT + '/compare/' + claimSha + '...' + testedHead + '?per_page=100');
  if (compare?.status !== 'ahead' || compare?.merge_base_commit?.sha !== claimSha ||
      !Number.isSafeInteger(compare.ahead_by) || compare.ahead_by < 1 ||
      compare.ahead_by > 100 || compare.total_commits !== compare.ahead_by ||
      !Array.isArray(compare.commits) || compare.commits.length !== compare.ahead_by)
    throw Error('Codex execution comparison incomplete or diverged');
  return compare.commits.map(c => ({
    sha: c.sha, parents: (c.parents || []).map(p => ({sha:p.sha})),
  }));
}
async function atBranch(path, head) {
  const raw = await get(ROOT + '/contents/' + path +
    '?ref=' + encodeURIComponent(head));
  if (raw?.encoding !== 'base64' || raw?.type !== 'file')
    throw Error('GitHub branch source is not a file');
  return Buffer.from(raw.content, 'base64').toString('utf8');
}
async function optionalRecord(path, head) {
  const raw = await get(ROOT + '/contents/' + path +
    '?ref=' + encodeURIComponent(head), { optional: true });
  if (raw === null) return undefined;
  if (raw?.encoding !== 'base64' || raw?.type !== 'file')
    throw Error('Task record could not be verified');
  return JSON.parse(Buffer.from(raw.content, 'base64').toString('utf8'));
}
async function runs(event, sha) {
  const query = '?event=' + encodeURIComponent(event) +
    '&head_sha=' + sha + '&per_page=100';
  const list = await get(ROOT + '/actions/runs' + query);
  return validateCodexWorkflowInventory(list).filter(run => run.head_sha === sha &&
    run.event === event);
}
async function pullRuns(sha) {
  const results = await runs('pull_request', sha);
  const accepted = results.filter(run =>
    run.name === 'Ultron core verification');
  const enriched = [];
  for (const run of accepted) {
    if (!Number.isSafeInteger(run.id)) throw Error('Invalid workflow run ID');
    const jobs = await get(ROOT + '/actions/runs/' + run.id +
      '/jobs?per_page=100');
    if (!Array.isArray(jobs?.jobs) || !Number.isSafeInteger(jobs.total_count) ||
        jobs.total_count !== jobs.jobs.length || jobs.total_count >= 100)
      throw Error('Workflow job evidence incomplete');
    enriched.push({ ...run, jobs: jobs.jobs });
  }
  return enriched;
}
async function main() {
  const number = process.argv[2];
  if (!ID.test(number || '') || process.argv.length !== 3)
    throw Error('Usage: node scripts/codex-lane-status.mjs <PR-number>');
  const pr = await get(ROOT + '/pulls/' + number);
  const call = parseCodexCall(pr.body);
  const issue = await get(ROOT + '/issues/' + call.issueNumber);
  const main = await get(ROOT + '/git/ref/heads/main');
  if (!SHA.test(main?.object?.sha || '') || !SHA.test(pr.head?.sha || ''))
    throw Error('Source identity could not be established');
  const source = await atBranch('docs/proposals/issue-' + call.issueNumber +
    '.md', pr.head.sha);
  const paths = codexRecordPaths(call);
  const [claim, receipt, pulls, dispatched, ownerComments] = await Promise.all([
    optionalRecord(paths.claim, pr.head.sha),
    optionalRecord(paths.receipt, pr.head.sha),
    pullRuns(pr.head.sha), runs('workflow_dispatch', pr.head.sha),
    get(ROOT + '/issues/' + pr.number + '/comments?per_page=100'),
  ]);
  if (!Array.isArray(ownerComments) || ownerComments.length >= 100)
    throw Error('Owner comment audit incomplete');
  const [claimProvenance, receiptProvenance] = await Promise.all([
    claim === undefined ? undefined : recordHistory(paths.claim, pr.head.sha),
    receipt === undefined ? undefined : recordHistory(paths.receipt, pr.head.sha),
  ]);
  const executionHistory = claim && receipt ?
    await executionChain(claimProvenance.commit.sha, receipt.headSha) : undefined;
  const bindingFingerprint = resolveCodexAuthor(call.authorId,{ requireBinding:true })
    .binding.fingerprint;
  const report = assessCodexLane({
    pr, issue, proposalText: source,
    mainSha: main.object.sha,
    bindingFingerprint,
    pullRequestRuns: pulls, workflowDispatchRuns: dispatched,
    ownerComments,
    ...(executionHistory === undefined ? {} : {executionHistory}),
    ...(claimProvenance === undefined ? {} : {
      claimHistory: claimProvenance.history, claimCommit: claimProvenance.commit }),
    ...(receiptProvenance === undefined ? {} : {
      receiptHistory: receiptProvenance.history, receiptCommit: receiptProvenance.commit }),
    ...(claim === undefined ? {} : { claim }),
    ...(receipt === undefined ? {} : { receipt }),
  });
  const after = await get(ROOT + '/pulls/' + number);
  const end = await get(ROOT + '/git/ref/heads/main');
  const issueAfter = await get(ROOT + '/issues/' + call.issueNumber);
  validateCodexLaneReadback({ beforePr:pr, afterPr:after,
    beforeIssue:issue, afterIssue:issueAfter,
    beforeMainSha:main.object.sha, afterMainSha:end?.object?.sha,
    proposalText:source, bindingFingerprint });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => {
  console.error('Codex lane evidence not established. No execution/identity acceptance.');
  process.exitCode = 2;
});
