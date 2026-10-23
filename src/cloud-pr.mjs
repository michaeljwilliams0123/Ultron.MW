import { launchCodePr, CODE_PR_TITLE, CODE_PR_MARKER } from './code-pr.mjs';
import { parseCodexObjective } from '../docs/core/codex-authors.mjs';
import { buildCodexCall, formatCodexCall, parseCodexCall } from './codex-call.mjs';
import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PR_REPOSITORY = 'michaeljwilliams0123/Ultron.MW';
export const PR_OWNER = 'michaeljwilliams0123';
export const PR_ISSUE_TITLE = '[Ultron PR] Create proposal';
export const PR_MARKER = 'ULTRON_PR_V1';
const SHA = /^[0-9a-f]{40}$/;
const PR_BODY_LIMIT = 1000;
const REPO_API = '/repos/' + PR_REPOSITORY;

export function parsePrRequest(event, actor, repository) {
  const issue = event?.issue;
  if (repository !== PR_REPOSITORY || actor !== PR_OWNER ||
      event?.action !== 'opened' || issue?.user?.login !== PR_OWNER ||
      issue?.title !== PR_ISSUE_TITLE || issue?.pull_request ||
      issue?.state !== 'open' || !Number.isSafeInteger(issue?.number) ||
      issue.number <= 0 || typeof issue.body !== 'string' ||
      !issue.body.startsWith(PR_MARKER + '\n'))
    throw Error('PR request is not an owner-confirmed Ultron issue');
  const objective = issue.body.slice(PR_MARKER.length + 1);
  if (!objective.trim() || objective !== objective.trim() ||
      objective.length > PR_BODY_LIMIT || /[\r\n\u0000-\u001f]/.test(objective))
    throw Error('PR request must contain one line of 1–1000 public characters');
  const codex = parseCodexObjective(objective);
  return {
    codex,
    issueNumber: issue.number, objective, eventIssue: issue,
    branch: 'ultron/issue-' + issue.number,
    filePath: 'docs/proposals/issue-' + issue.number + '.md',
    title: codex ? '[Ultron Codex] ' + codex.author.id + ' · issue ' + issue.number :
      'ultron: ' + objective.slice(0, 76),
    requestedDigest: createHash('sha256').update(objective).digest('hex'),
  };
}

export function proposalContent(request, mainSha) {
  if (!SHA.test(mainSha)) throw Error('Unverified main SHA');
  if (request.codex) return [
    '# ' + request.codex.author.name + ' task #' + request.issueNumber, '',
    'Owner request: https://github.com/' + PR_REPOSITORY + '/issues/' + request.issueNumber,
    'Request digest: ' + request.requestedDigest, '',
    'A named Work executor must validate this request and persist its own completion receipt.',
    'Enrollment is not execution proof. No automatic merge is authorized.', '',
    formatCodexCall(buildCodexCall({ ...request, sourceSha: mainSha })), '',
  ].join('\n');
  return [
    '# Ultron implementation proposal #' + request.issueNumber, '',
    'Source task: https://github.com/' + PR_REPOSITORY + '/issues/' + request.issueNumber,
    'Target branch: main', 'Source main SHA: ' + mainSha, '',
    '## Requested capability', '',
    '> ' + request.objective.replaceAll('<', '&lt;').replaceAll('>', '&gt;'), '',
    '## Scope and acceptance', '',
    '- This PR records a bounded owner-confirmed implementation proposal.',
    '- No source-code behavior changes are asserted until an implementation commit is verified.',
    '- All future code changes must pass the existing required test check.',
    '- No model API, arbitrary shell, or workstation access is implied.', '',
    'Request digest: ' + request.requestedDigest, '',
  ].join('\n');
}

function apiPath(path) { return REPO_API + path; }
function validPr(pr, request) {
  return Number.isSafeInteger(pr?.number) && pr.number > 0 &&
    pr.head?.ref === request.branch && pr.base?.ref === 'main' &&
    pr.head?.repo?.full_name === PR_REPOSITORY &&
    pr.base?.repo?.full_name === PR_REPOSITORY &&
    pr.body?.includes('Ultron issue #' + request.issueNumber);
}

/**
 * Owner-confirmed, deterministic GitHub-native PR launcher. One documentation
 * proposal PR targeting main. No workstation, model or shell execution.
 */
export async function launchCloudPr({ event, actor, repository, executorSha,
  get, getOptional, post, put } = {}) {
  const request = parsePrRequest(event, actor, repository);
  if (!SHA.test(executorSha || '') || typeof get !== 'function' ||
      typeof getOptional !== 'function' || typeof post !== 'function' ||
      typeof put !== 'function') throw Error('PR launcher missing trusted GitHub context');

  const current = await get(apiPath('/issues/' + request.issueNumber));
  if (current?.number !== request.issueNumber || current.state !== 'open' ||
      current.user?.login !== PR_OWNER || current.title !== PR_ISSUE_TITLE ||
      current.body !== request.eventIssue.body)
    throw Error('Owner PR request changed since admission');

  const ref = await get(apiPath('/git/ref/heads/main'));
  if (ref?.object?.sha !== executorSha)
    throw Error('PR creation rejected: runner is not current main');
  const expectedFile = proposalContent(request, executorSha);
  const codexCall = request.codex ? buildCodexCall({ ...request, sourceSha: executorSha }) : null;
  const query = '?state=all&head=' + encodeURIComponent(PR_OWNER + ':' + request.branch) +
    '&per_page=100';
  const existing = await get(apiPath('/pulls' + query));
  if (!Array.isArray(existing)) throw Error('PR duplicate check was not available');
  const found = existing.find(pr => validPr(pr, request));
  if (found) {
    const verified = await get(apiPath('/pulls/' + found.number));
    if (!validPr(verified, request)) throw Error('Existing PR read-back failed');
    const existingFile = await get(apiPath('/contents/' + request.filePath) +
      '?ref=' + encodeURIComponent(request.branch));
    const contents = Buffer.from(existingFile?.content || '', 'base64').toString('utf8');
    if (existingFile?.encoding !== 'base64' ||
        !contents.includes('Request digest: ' + request.requestedDigest))
      throw Error('Existing PR proposal content does not match original owner request');
    if (codexCall && (parseCodexCall(verified.body).digest !== codexCall.digest ||
        parseCodexCall(contents).digest !== codexCall.digest || verified.title !== request.title))
      throw Error('Existing Codex request envelope changed');
    return { status: 'already-created', issueNumber: request.issueNumber,
      prNumber: verified.number, prUrl: verified.html_url, branch: request.branch,
      base: 'main', executorSha, contentVerified: true, created: false,
      ...(codexCall ? { codexAuthor: codexCall.authorId, codexTaskId: codexCall.taskId } : {}) };
  }

  const branchRefPath = apiPath('/git/ref/heads/' + request.branch);
  const oldRef = await getOptional(branchRefPath);
  if (!oldRef) {
    const created = await post(apiPath('/git/refs'), {
      ref: 'refs/heads/' + request.branch, sha: executorSha,
    });
    if (created?.ref !== 'refs/heads/' + request.branch)
      throw Error('Branch creation response not verified');
  }
  const currentBranch = await get(branchRefPath);
  if (!SHA.test(currentBranch?.object?.sha || ''))
    throw Error('Branch SHA was not independently verified');
  const contentPath = apiPath('/contents/' + request.filePath);
  const fileRef = contentPath + '?ref=' + encodeURIComponent(request.branch);
  const oldFile = await getOptional(fileRef);
  if (oldFile) {
    const decoded = Buffer.from(oldFile.content || '', 'base64').toString('utf8');
    if (oldFile.encoding !== 'base64' || decoded !== expectedFile)
      throw Error('Existing proposal content differs from owner request');
  } else {
    if (currentBranch.object.sha !== executorSha)
      throw Error('Existing PR branch has unrelated changes; refusing to write');
    await put(contentPath, {
      message: 'docs: create Ultron owner proposal #' + request.issueNumber,
      content: Buffer.from(expectedFile, 'utf8').toString('base64'),
      branch: request.branch,
    });
  }
  const confirmed = await get(fileRef);
  if (confirmed?.encoding !== 'base64' ||
      Buffer.from(confirmed.content || '', 'base64').toString('utf8') !== expectedFile)
    throw Error('Proposed file could not be independently read back');

  const nextMain = await get(apiPath('/git/ref/heads/main'));
  if (nextMain?.object?.sha !== executorSha)
    throw Error('Main changed before PR creation; no PR was published');
  const after = await get(apiPath('/pulls' + query));
  if (!Array.isArray(after)) throw Error('PR read-back query unavailable');
  let pr = after.find(item => validPr(item, request));
  let created = false;
  if (!pr) {
    const body = [
      '## Ultron issue #' + request.issueNumber,
      '', 'Requested change: ' + request.objective,
      '', 'This PR adds a reviewable documentation proposal under ' + request.filePath + '.',
      codexCall ? 'Named Work task; execution awaits an independent executor receipt.' :
        'Implementation code is not yet generated.',
      'Base: main @ ' + executorSha + '.',
      'Owner confirmed submission through a GitHub Issue.',
      'No automatic merge or deployment is requested.',
      ...(codexCall ? ['', formatCodexCall(codexCall)] : []),
    ].join('\n');
    pr = await post(apiPath('/pulls'), {
      title: request.title, head: request.branch, base: 'main', body,
      draft: false, maintainer_can_modify: true,
    });
    created = true;
  }
  if (!validPr(pr, request))
    throw Error('Pull request did not match expected branch and main base');
  const verifiedPr = await get(apiPath('/pulls/' + pr.number));
  if (!validPr(verifiedPr, request) ||
      verifiedPr.head.sha === executorSha ||
      !/^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/pull\/\d+$/.test(
        verifiedPr.html_url || ''))
    throw Error('Created PR failed GitHub read-back verification');
  if (codexCall && (verifiedPr.title !== request.title ||
      parseCodexCall(verifiedPr.body).digest !== codexCall.digest))
    throw Error('Created Codex PR envelope failed read-back');

  // The workflow token is allowed to dispatch the existing exact-head
  // verification job even though a GITHUB_TOKEN-created PR may not emit
  // a normal pull_request workflow event.
  await post(apiPath('/actions/workflows/verify.yml/dispatches'),
    {ref: request.branch});

  const note = [
    '<!-- ULTRON_PR_RECEIPT_V1 -->',
    '### Ultron PR created targeting main',
    '',
    'Pull request: ' + verifiedPr.html_url,
    'Branch: ' + request.branch,
    'Target: main',
    'Verified source main: ' + executorSha,
    'Verified proposal file: ' + request.filePath,
    'Exact-head verification: requested through GitHub Actions',
    '',
    codexCall ? 'Named executor requested: ' + request.codex.author.name +
      '. Enrollment is not execution proof. Inspect the Work receipt on the PR branch.' :
      'This PR proposes documentation; it does not implement arbitrary code or merge automatically.',
    ...(codexCall ? ['If no Work run appears, the owner can comment exactly: /codex run ' +
      codexCall.authorId] : []),
  ].join('\n');
  const issued = await post(apiPath('/issues/' + request.issueNumber + '/comments'),
    {body:note});
  if (!Number.isSafeInteger(issued?.id) || issued.id <= 0)
    throw Error('PR receipt comment not acknowledged');
  const confirmedNote = await get(apiPath('/issues/comments/' + issued.id));
  if (confirmedNote?.id !== issued.id || confirmedNote.body !== note ||
      confirmedNote.user?.login !== 'github-actions[bot]')
    throw Error('PR receipt read-back verification failed');
  return { status: 'created', issueNumber: request.issueNumber,
    prNumber: verifiedPr.number, prUrl: verifiedPr.html_url,
    branch: request.branch, base: 'main', executorSha,
    contentVerified: true, verificationDispatched: true,
    receiptCommentId: issued.id, created,
    ...(codexCall ? { codexAuthor: codexCall.authorId, codexTaskId: codexCall.taskId } : {}) };
}

export async function githubRequest(path, { method = 'GET', body, optional = false } = {}) {
  if (!path.startsWith(REPO_API + '/') || !process.env.GITHUB_TOKEN)
    throw Error('Untrusted repository API request');
  const result = await fetch('https://api.github.com' + path, {
    method, signal: AbortSignal.timeout(16000),
    headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  if (optional && result.status === 404) return null;
  if (!result.ok)
    throw Error('GitHub API ' + method + ' failed with HTTP ' + result.status);
  if (result.status === 204) return {};
  return result.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
    const result = await (event?.issue?.title === CODE_PR_TITLE &&
      event?.issue?.body?.startsWith(CODE_PR_MARKER + '\n') ? launchCodePr : launchCloudPr)({
      event, actor: process.env.GITHUB_ACTOR,
      repository: process.env.GITHUB_REPOSITORY,
      executorSha: process.env.GITHUB_SHA,
      get: p => githubRequest(p),
      getOptional: p => githubRequest(p, { optional: true }),
      post: (p,body) => githubRequest(p, {method:'POST',body}),
      put: (p,body) => githubRequest(p, {method:'PUT',body}),
    });
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        '## Ultron Create PR to main\n\nResult: ' + result.status +
        '\nPR: ' + (result.prUrl || result.url) +
        '\nVerified main SHA: ' + (result.executorSha || result.commitSha) +
        '\nPC required: No\n\n' +
        'Code manifest issues commit real source changes; plain objectives remain documentation proposals.\n');
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error('Ultron PR action failed: ' + error.message);
    process.exitCode = 1;
  }
}
