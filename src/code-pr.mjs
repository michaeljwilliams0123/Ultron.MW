import { createHash } from 'node:crypto';

export const CODE_PR_MARKER = 'ULTRON_CODE_PR_V1';
export const CODE_PR_TITLE = '[Ultron PR] Implement code';
const REPO = 'michaeljwilliams0123/Ultron.MW';
const OWNER = 'michaeljwilliams0123';
const ROOT = '/repos/' + REPO;
const SHA = /^[0-9a-f]{40}$/;
const MAX_BODY = 30000;
const MAX_FILE = 16000;
const PATH = /^(?:src|docs|test|scripts)\/[a-zA-Z0-9_./-]+\.(?:mjs|js|md|json|css|html)$/;

export function parseCodePrRequest(event, actor, repository) {
  const issue = event?.issue;
  if (repository !== REPO || actor !== OWNER || event?.action !== 'opened' ||
    issue?.user?.login !== OWNER || issue?.title !== CODE_PR_TITLE ||
    issue?.state !== 'open' || issue?.pull_request ||
    !Number.isSafeInteger(issue?.number) || issue.number < 1 ||
    typeof issue.body !== 'string' ||
    !issue.body.startsWith(CODE_PR_MARKER + '\n') ||
    issue.body.length > MAX_BODY) throw Error('Not a valid owner-created code PR issue');
  let manifest;
  try { manifest = JSON.parse(issue.body.slice(CODE_PR_MARKER.length + 1)); }
  catch { throw Error('Invalid code PR manifest JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
    typeof manifest.objective !== 'string' ||
    manifest.objective !== manifest.objective.trim() ||
    !manifest.objective || manifest.objective.length > 500 ||
    /[\u0000-\u001f]/.test(manifest.objective) ||
    !SHA.test(manifest.baseSha || '') ||
    !Array.isArray(manifest.changes) ||
    manifest.changes.length < 1 || manifest.changes.length > 8)
    throw Error('Code PR requires objective, exact baseSha, and 1–8 changes');
  const seen = new Set();
  for (const entry of manifest.changes) {
    const path = entry?.path;
    if (typeof path !== 'string' || !PATH.test(path) ||
      path.split('/').some(part => !part || part === '..' || part.startsWith('.')) ||
      seen.has(path)) throw Error('Invalid or repeated code PR source path');
    seen.add(path);
    const create = Object.hasOwn(entry,'create');
    if (create) {
      if (Object.keys(entry).sort().join(',') !== 'create,path' ||
        typeof entry.create !== 'string' || !entry.create.length ||
        entry.create.length > MAX_FILE) throw Error('Invalid source-file creation');
    } else if (Object.keys(entry).sort().join(',') !== 'after,before,path' ||
      typeof entry.before !== 'string' || !entry.before ||
      typeof entry.after !== 'string' || entry.after.length > MAX_FILE ||
      entry.before.length > MAX_FILE || entry.before === entry.after) {
      throw Error('Source edits require a nonempty exact before and changed after');
    }
  }
  const digest = createHash('sha256').update(issue.body).digest('hex');
  return { issueNumber:issue.number, objective:manifest.objective,
    baseSha:manifest.baseSha, changes:manifest.changes, digest,
    eventBody:issue.body, branch:'ultron/code-issue-' + issue.number };
}

function modifiedSource(entry, original) {
  if (Object.hasOwn(entry,'create')) {
    if (original !== null) throw Error('New path already exists: ' + entry.path);
    return entry.create;
  }
  if (original === null) throw Error('Requested existing file is missing: ' + entry.path);
  const first = original.indexOf(entry.before);
  if (first === -1 || original.indexOf(entry.before,first+entry.before.length) !== -1)
    throw Error('Exact patch context missing or ambiguous: ' + entry.path);
  const output = original.slice(0,first) + entry.after +
    original.slice(first+entry.before.length);
  if (output === original || output.length > MAX_FILE * 6)
    throw Error('Patch does not change source or exceeds file limit');
  return output;
}

function matches(pr, request) {
  return Number.isSafeInteger(pr?.number) && pr.number > 0 &&
    pr.head?.ref === request.branch && pr.base?.ref === 'main' &&
    pr.head?.repo?.full_name === REPO && pr.base?.repo?.full_name === REPO &&
    pr.body?.includes('Manifest digest: ' + request.digest);
}

/** GitHub-native atomic source commit and real PR targeting main.
 * Source proposal is supplied by an owner-authored GitHub Issue. No model
 * inference, shell, self-granted credentials, merge or deployment is implied.
 */
export async function launchCodePr({event,actor,repository,executorSha,
  get,getOptional,post}={}) {
  const request = parseCodePrRequest(event,actor,repository);
  if (!SHA.test(executorSha || '') || !get || !getOptional || !post)
    throw Error('Missing trusted Actions executor context');
  const current = await get(ROOT+'/issues/'+request.issueNumber);
  if (current?.state !== 'open' || current?.number !== request.issueNumber ||
    current?.user?.login !== OWNER || current?.title !== CODE_PR_TITLE ||
    current?.body !== request.eventBody)
    throw Error('Source owner issue changed; code PR not admitted');
  const main = await get(ROOT+'/git/ref/heads/main');
  if (main?.object?.sha !== executorSha || request.baseSha !== executorSha)
    throw Error('Exact-main lease or manifest base SHA changed');
  const query = '?state=all&head='+encodeURIComponent(OWNER+':'+request.branch)+'&per_page=100';
  const prs = await get(ROOT+'/pulls'+query);
  if (!Array.isArray(prs)) throw Error('Duplicate PR query not available');
  const previous = prs.find(pr=>matches(pr,request));
  if (previous) {
    const confirmed = await get(ROOT+'/pulls/'+previous.number);
    if (!matches(confirmed,request) || !SHA.test(confirmed.head?.sha||''))
      throw Error('Existing code PR could not be independently verified');
    return {status:'already-created',url:confirmed.html_url,
      number:confirmed.number,base:'main',branch:request.branch,created:false};
  }
  if (await getOptional(ROOT+'/git/ref/heads/'+request.branch))
    throw Error('Existing unverified branch cannot be overwritten');

  const head = await get(ROOT+'/git/commits/'+executorSha);
  if (!SHA.test(head?.tree?.sha||'')) throw Error('Main tree unavailable');
  const changes = [];
  for (const entry of request.changes) {
    const target=ROOT+'/contents/'+entry.path+'?ref='+executorSha;
    const existing=await getOptional(target);
    if (existing && existing.encoding !== 'base64') throw Error('Unexpected source encoding');
    const original=existing ? Buffer.from(existing.content||'','base64').toString('utf8'):null;
    const content=modifiedSource(entry,original);
    changes.push({path:entry.path,content});
  }
  const prewrite = await get(ROOT+'/git/ref/heads/main');
  if (prewrite?.object?.sha !== executorSha)
    throw Error('Main moved before creating code PR commit');

  const treeEntries = [];
  for (const change of changes) {
    const blob = await post(ROOT+'/git/blobs',{content:change.content,encoding:'utf-8'});
    if (!SHA.test(blob?.sha||'')) throw Error('GitHub did not confirm source blob');
    treeEntries.push({path:change.path,mode:'100644',type:'blob',sha:blob.sha});
  }
  const tree=await post(ROOT+'/git/trees',{base_tree:head.tree.sha,tree:treeEntries});
  if (!SHA.test(tree?.sha||'') || tree.sha === head.tree.sha)
    throw Error('Code PR tree was not verified as changed');
  const commit=await post(ROOT+'/git/commits',{
    message:'feat: implement Ultron owner code task #'+request.issueNumber,
    tree:tree.sha,parents:[executorSha]});
  if (!SHA.test(commit?.sha||'')) throw Error('Source commit not acknowledged');
  if ((await get(ROOT+'/git/ref/heads/main'))?.object?.sha !== executorSha)
    throw Error('Main moved before publication; no branch or PR created');
  const createdRef=await post(ROOT+'/git/refs',{
    ref:'refs/heads/'+request.branch,sha:commit.sha});
  if (createdRef?.object?.sha !== commit.sha ||
      (await get(ROOT+'/git/ref/heads/'+request.branch))?.object?.sha !== commit.sha)
    throw Error('Published branch not independently verified');
  const body=['## Ultron code implementation #'+request.issueNumber,'',
    'Owner objective: '+request.objective,'',
    'Manifest digest: '+request.digest,
    'Based on exact main SHA: '+executorSha,
    'Changed source files: '+changes.map(x=>x.path).join(', '),'',
    'GitHub Actions verifies syntax and tests on the proposed head. No automatic merge or deployment.'].join('\n');
  const pr=await post(ROOT+'/pulls',{
    title:'ultron: '+request.objective.slice(0,72),head:request.branch,
    base:'main',draft:false,body,maintainer_can_modify:true});
  if (!matches(pr,request)) throw Error('GitHub PR creation response did not match request');
  const checked=await get(ROOT+'/pulls/'+pr.number);
  if (!matches(checked,request) || checked.head?.sha !== commit.sha ||
    !/^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/pull\/\d+$/.test(checked.html_url||''))
    throw Error('PR source and target read-back failed');
  for (const item of changes) {
    const file=await get(ROOT+'/contents/'+item.path+'?ref='+encodeURIComponent(request.branch));
    if (file?.encoding !== 'base64' ||
      Buffer.from(file.content||'','base64').toString('utf8') !== item.content)
      throw Error('PR file read-back failed: '+item.path);
  }
  await post(ROOT+'/actions/workflows/verify.yml/dispatches',{ref:request.branch});
  const note='<!-- ULTRON_CODE_PR_RECEIPT_V1 -->\nCode PR targeting main: '+checked.html_url+
    '\nExact main: '+executorSha+'\nCommit: '+commit.sha+
    '\nFiles: '+changes.map(x=>x.path).join(', ')+
    '\nHead verification dispatched. No auto-merge or deployment.';
  const receipt=await post(ROOT+'/issues/'+request.issueNumber+'/comments',{body:note});
  if (!Number.isSafeInteger(receipt?.id)) throw Error('Receipt comment not confirmed');
  const verified=await get(ROOT+'/issues/comments/'+receipt.id);
  if (verified?.body !== note || verified?.user?.login !== 'github-actions[bot]')
    throw Error('Receipt read-back failed');
  return {status:'created',url:checked.html_url,number:checked.number,
    branch:request.branch,base:'main',commitSha:commit.sha,files:changes.map(x=>x.path),
    verificationDispatched:true,created:true};
}
