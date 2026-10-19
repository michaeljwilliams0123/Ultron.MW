import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { githubRequest } from './cloud-pr.mjs';
import { observeCloudSelf } from './self-observer.mjs';

export const SELF_SCAN_REPO = 'michaeljwilliams0123/Ultron.MW';
export const SELF_SCAN_OWNER = 'michaeljwilliams0123';
export const SELF_SCAN_MARKER = '<!-- ULTRON_SELF_SCAN_PR_V1 -->';
export const SELF_SCAN_PATH = 'reports/self-scan/current.md';
const REPO_API = '/repos/' + SELF_SCAN_REPO;
const SHA = /^[0-9a-f]{40}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;
const BRANCH_PREFIX = 'ultron/self-scan-';
const FILE_MARKER = '<!-- ULTRON_SELF_SCAN_REPORT_V1 -->';

export function selfScanSignature(report) {
  if (report?.schema !== 'ultron.self-model.v1' ||
      report?.environment !== 'cloud' ||
      !SHA.test(report?.sourceAuthority?.commitSha || '') ||
      !SHA.test(report?.sourceAuthority?.treeSha || '') ||
      !Array.isArray(report.evidence) || !Array.isArray(report.weaknesses))
    throw Error('Cannot publish an unverified self-scan');
  // Only material findings affect the signature. Main SHA and scan timestamp
  // remain in the audit report, but do not create hourly PR noise.
  const material = {
    schema: report.schema,
    sourceEvidence: report.evidence.map(x => [x.kind, x.sourcePath, x.status, x.detail]),
    weaknesses: report.weaknesses.map(x => [x.code, x.priority, x.detail, x.repair]),
    inventory: report.inventory,
    uncertainty: report.uncertainty,
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

export function reportSignature(text) {
  if (typeof text !== 'string' || !text.startsWith(FILE_MARKER + '\n')) return null;
  const match = text.match(/^Finding signature: ([0-9a-f]{64})$/m);
  return match ? match[1] : null;
}
const clean = value => String(value).replace(/[\r\n|]/g, ' ').replace(/[<>]/g,'').slice(0,600);

export function renderScanReport(report, signature = selfScanSignature(report)) {
  if (!SIGNATURE.test(signature) || signature !== selfScanSignature(report))
    throw Error('Unverified self-scan signature');
  const lines = [
    FILE_MARKER,
    '# Ultron self-scan — actionable source findings',
    '',
    'Finding signature: ' + signature,
    'Observed GitHub main SHA: ' + report.sourceAuthority.commitSha,
    'Observed source tree SHA: ' + report.sourceAuthority.treeSha,
    'Observed at: ' + report.observedAt,
    'Authority: exact GitHub main, not a deployed production runtime',
    '',
    '## Findings',
    '',
    '| Priority | Code | Evidence | Suggested next action |',
    '| --- | --- | --- | --- |',
    ...report.weaknesses.map(x =>
      '| ' + clean(x.priority) + ' | ' + clean(x.code) + ' | ' +
      clean(x.detail) + ' | ' + clean(x.repair) + ' |'),
    '',
    '## Scanned source',
    '',
    '- Files inventoried: ' + report.inventory.allFiles,
    '- Source files: ' + report.inventory.source,
    '- Test files: ' + report.inventory.tests,
    '- Workflow files: ' + report.inventory.workflows,
    '- Static evidence coverage: ' + report.uncertainty.sourceCoverage,
    '- Observed current-main CI: ' + (report.uncertainty.ciHeadReadiness||'not-probed'),
    '- GitHub CI evidence run: ' + (report.sourceAuthority.ciObservation?.runUrl||'unavailable'),
    '',
    '## Static wiring checks',
    '',
    ...report.evidence.filter(x => x.kind === 'static-route-link')
      .map(x => '- ' + clean(x.sourcePath) + ': ' + clean(x.status)),
    '',
    '## Unverified capabilities (do not treat as healthy)',
    '',
    '- Runtime: ' + clean(report.uncertainty.operationalReadiness),
    '- Provider: ' + clean(report.uncertainty.providerReadiness),
    '- Production convergence: ' + clean(report.uncertainty.productionConvergence),
    '- Independent learning gain: ' + clean(report.uncertainty.independentLearningGain),
    '',
    '## Next steps',
    '',
    ...report.nextActions.map(x => '- ' + clean(x)),
    '',
    'This PR is a source scan, not a verified code fix.',
    'Proposed repairs require separate tested implementation before closure.',
    '',
  ];
  return lines.join('\n');
}

function validatePull(pr) {
  return pr?.state === 'open' && pr?.head?.ref?.startsWith(BRANCH_PREFIX) &&
    pr?.head?.repo?.full_name === SELF_SCAN_REPO &&
    pr?.base?.ref === 'main' && pr?.base?.repo?.full_name === SELF_SCAN_REPO &&
    typeof pr?.body === 'string' && pr.body.startsWith(SELF_SCAN_MARKER);
}
function fileBytes(file) {
  if (!file) return null;
  if (file.encoding !== 'base64' || typeof file.content !== 'string' ||
      !SHA.test(file.sha || '')) throw Error('Scan artifact has invalid GitHub file evidence');
  return Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8');
}

/** Publish a direct PR; no Issue creation and no model-authored code changes. */
export async function publishSelfScanPr({
  eventName, actor, repository, executorSha,
  get, getOptional, post, put,
  scan = observeCloudSelf,
} = {}) {
  if (repository !== SELF_SCAN_REPO ||
    !['schedule','workflow_dispatch'].includes(eventName) ||
    (eventName === 'workflow_dispatch' && actor !== SELF_SCAN_OWNER) ||
    !SHA.test(executorSha || '') ||
    typeof get !== 'function' || typeof getOptional !== 'function' ||
    typeof post !== 'function' || typeof put !== 'function')
    throw Error('Self-scan PR requires trusted GitHub Actions context');

  const report = await scan({get});
  if (report?.sourceAuthority?.commitSha !== executorSha)
    throw Error('Self-scan executor is not canonical current main');
  const signature = selfScanSignature(report);
  const content = renderScanReport(report,signature);
  const latestPath = REPO_API + '/contents/' + SELF_SCAN_PATH;
  const currentFile = await getOptional(latestPath + '?ref=' + executorSha);
  if (currentFile && reportSignature(fileBytes(currentFile)) === signature)
    return { status: 'unchanged', created: false, signature,
      observedMainSha: executorSha, base: 'main', reason: 'Findings already landed on main' };

  const listing = await get(REPO_API + '/pulls?state=open&per_page=100');
  if (!Array.isArray(listing) || listing.length >= 100)
    throw Error('Cannot establish complete active scan PR inventory');
  const scanPRs = listing.filter(validatePull);
  if (scanPRs.length > 1) throw Error('Multiple active scan PRs require reconciliation');
  const active = scanPRs[0] ?? null;
  const branch = active?.head.ref || BRANCH_PREFIX + signature.slice(0,16);
  const branchPath = REPO_API + '/git/ref/heads/' + branch;
  if (active) {
    const confirmed = await get(REPO_API + '/pulls/' + active.number);
    if (!validatePull(confirmed) || confirmed.head.ref !== branch)
      throw Error('Active scan PR no longer matches verified routing');
  } else if (await getOptional(branchPath)) {
    throw Error('Existing scan branch without active PR; reconcile before reuse');
  }

  const existing = active ?
    await getOptional(latestPath + '?ref=' + encodeURIComponent(branch)) : null;
  if (existing && reportSignature(fileBytes(existing)) === signature) {
    return { status:'already-open', created:false, updated:false,
      prNumber:active.number, prUrl:active.html_url, branch,
      signature, observedMainSha:executorSha, base:'main' };
  }
  if (existing && !fileBytes(existing).startsWith(FILE_MARKER + '\n'))
    throw Error('Cannot overwrite an unrelated scan artifact');

  if ((await get(REPO_API + '/git/ref/heads/main'))?.object?.sha !== executorSha)
    throw Error('Main changed since scan; no source publication was attempted');

  if (!active) {
    const branchCreated = await post(REPO_API + '/git/refs',
      {ref:'refs/heads/'+branch,sha:executorSha});
    if (branchCreated?.ref !== 'refs/heads/'+branch)
      throw Error('Scan PR branch creation not confirmed');
    const found = await get(branchPath);
    if (found?.object?.sha !== executorSha)
      throw Error('Scan PR branch could not be independently verified');
  }
  const written = await put(latestPath, {
    message:'docs: record observed Ultron self-scan findings',
    branch,
    content: Buffer.from(content,'utf8').toString('base64'),
    ...(existing ? {sha:existing.sha} : {}),
  });
  if (!SHA.test(written?.commit?.sha || ''))
    throw Error('GitHub did not acknowledge scan report commit');
  const readback = await get(latestPath + '?ref=' + encodeURIComponent(branch));
  if (fileBytes(readback) !== content)
    throw Error('Scan report commit failed independent byte verification');
  if ((await get(REPO_API + '/git/ref/heads/main'))?.object?.sha !== executorSha)
    throw Error('Main changed before scan PR publication');

  let pr = active;
  let created = false;
  if (!pr) {
    const description = [
      SELF_SCAN_MARKER,
      '## Ultron operational self-scan',
      '',
      'Scan findings are committed under ' + SELF_SCAN_PATH,
      'This PR proposes evidence-based follow-up, not an automatically fixed defect.',
      '',
      'Observed main SHA: ' + executorSha,
      'Finding signature: ' + signature,
      'Unknown runtime, provider and model quality remain unverified.',
      '',
      'Only material changes update this PR. No GitHub Issues or parallel scan PRs are generated.',
    ].join('\n');
    pr = await post(REPO_API+'/pulls',{
      title:'ultron: self-scan findings and improvement candidates',
      head:branch,base:'main',body:description,draft:false,
      maintainer_can_modify:true,
    });
    created = true;
  }
  if (!validatePull(pr)) throw Error('Published scan PR identity invalid');
  const confirmedPr = await get(REPO_API + '/pulls/' + pr.number);
  if (!validatePull(confirmedPr) ||
      confirmedPr.head.ref !== branch ||
      confirmedPr.head.sha !== written.commit.sha ||
      !/^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/pull\/\d+$/.test(confirmedPr.html_url||''))
    throw Error('Scan PR verification failed on head SHA or main base');

  await post(REPO_API+'/actions/workflows/verify.yml/dispatches',{ref:branch});
  return {status:created?'created':'updated',created,updated:!created,
    prNumber:confirmedPr.number,prUrl:confirmedPr.html_url,
    branch,base:'main',signature,observedMainSha:executorSha,
    commitSha:written.commit.sha,verificationDispatched:true,
    weaknessCount:report.weaknesses.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await publishSelfScanPr({
      eventName:process.env.GITHUB_EVENT_NAME,actor:process.env.GITHUB_ACTOR,
      repository:process.env.GITHUB_REPOSITORY,executorSha:process.env.GITHUB_SHA,
      get:p=>githubRequest(p),
      getOptional:p=>githubRequest(p,{optional:true}),
      post:(p,body)=>githubRequest(p,{method:'POST',body}),
      put:(p,body)=>githubRequest(p,{method:'PUT',body}),
    });
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY,[
        '## Ultron self-scan to PR',
        '- Status: '+result.status,
        '- Target: main',
        '- PR: '+(result.prUrl||'No new findings; unchanged'),
        '- Observed main SHA: '+result.observedMainSha,
        '- Finding signature: '+result.signature,
        '- Issues created: 0',
        '- PC required: No',
        '',
      ].join('\n'));
    console.log(JSON.stringify(result));
  } catch(error) {
    console.error('Ultron self-scan PR failed: '+error.message);
    process.exitCode=1;
  }
}
