/**
 * The Sister Challenge is an owner-authorized READ-ONLY control audit.
 * It does not access runtime endpoints, use exploits, create PRs in the
 * private target, or give Ultron's advisory council new action authority.
 *
 * Nothing from the private GitHub response is copied into the report.
 */
export const SISTER_TARGET = 'michaeljwilliams0123/mahoraga';
export const SISTER_CHALLENGER = 'michaeljwilliams0123/Ultron.MW';
const SHA = /^[0-9a-f]{40}$/;
const ROOT = '/repos/';
const REQUIRED = ['Verify (ubuntu-latest)', 'Verify (windows-latest)'];

function refuse(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function finding(priority, code, repair) {
  return Object.freeze({ priority, code, repair });
}
const FIXES = Object.freeze({
  protection: 'Verify that active exact-main PR, deletion, non-fast-forward and required-check rules all apply.',
  ci: 'Obtain a successful current-head Verify run; a skipped, pending or historical run is not acceptance.',
  governance: 'Review standing bypass and zero-approval rules, and test that non-owner changes cannot bypass expected review.',
  privacy: 'Keep private repository files, API payloads, commit identifiers and credentials out of public Ultron artifacts.',
  runtime: 'Complete a separate owner-authenticated, end-to-end execution receipt before claiming runtime access.',
});

/**
 * Pure evaluator: all returned text is fixed, not copied from private inputs.
 * Missing evidence produces findings, never a fabricated pass.
 */
export function evaluateSisterEvidence({ challenger, target, mainRef, rulesets, workflowRuns } = {}) {
  if (challenger?.full_name !== SISTER_CHALLENGER ||
      challenger?.private !== false || challenger?.default_branch !== 'main' ||
      target?.full_name !== SISTER_TARGET || target?.private !== true ||
      target?.default_branch !== 'main' ||
      !SHA.test(mainRef?.object?.sha || '') ||
      !Array.isArray(rulesets) || !Array.isArray(workflowRuns))
    refuse('sister-read-evidence-invalid');
  const headSha = mainRef.object.sha;
  const activeMain = rulesets.filter(item =>
    item?.enforcement === 'active' &&
    item?.target === 'branch' &&
    item?.conditions?.ref_name?.include?.includes('refs/heads/main') &&
    !item?.conditions?.ref_name?.exclude?.includes('refs/heads/main'));
  const hasRule = type => activeMain.some(item => item.rules?.some(rule => rule?.type === type));
  const protections = activeMain.flatMap(item => Array.isArray(item.rules) ? item.rules : []);
  const checks = protections.filter(item => item.type === 'required_status_checks');
  const requiredChecks = [...new Set(checks.flatMap(item =>
    Array.isArray(item.parameters?.required_status_checks)
      ? item.parameters.required_status_checks.map(x => x.context) : []))];
  const exactHead = checks.some(item =>
    item.parameters?.strict_required_status_checks_policy === true);
  const protectedMain = hasRule('deletion') && hasRule('non_fast_forward') &&
    hasRule('pull_request') && exactHead &&
    REQUIRED.every(context => requiredChecks.includes(context));
  const review = protections.filter(item => item.type === 'pull_request');
  const zeroApproval = review.length > 0 &&
    review.every(item => item.parameters?.required_approving_review_count === 0);
  const alwaysBypass = activeMain.some(item =>
    Array.isArray(item.bypass_actors) &&
    item.bypass_actors.some(actor => actor.bypass_mode === 'always'));
  const exactRuns = workflowRuns.filter(item =>
    item?.head_sha === headSha &&
    (item?.path === '.github/workflows/verify.yml' ||
      item?.path === 'michaeljwilliams0123/mahoraga/.github/workflows/verify.yml' ||
      item?.name === 'Verify Mahoraga'));
  const latest = [...exactRuns].sort((a, b) =>
    (Number(b.run_number) || 0) - (Number(a.run_number) || 0))[0];
  const currentHeadCiSuccess = latest?.status === 'completed' && latest?.conclusion === 'success';
  const findings = [];
  if (!protectedMain) findings.push(finding('P1', 'sister-main-protection-unverified', FIXES.protection));
  if (!currentHeadCiSuccess) findings.push(finding('P1', 'sister-current-main-ci-unverified', FIXES.ci));
  if (zeroApproval || alwaysBypass)
    findings.push(finding('P2', 'sister-governance-override-review', FIXES.governance));
  findings.push(finding('P1', 'public-private-evidence-boundary', FIXES.privacy));
  findings.push(finding('P1', 'live-owner-execution-not-tested', FIXES.runtime));
  return Object.freeze({
    schemaVersion: 1,
    kind: 'ultron.sister-challenge.readonly',
    targetVerified: true,
    sourceVerified: true,
    authority: 'read-only-source-and-repository-metadata',
    council: Object.freeze(['sentinel', 'verifier', 'skeptic', 'architect']),
    evidence: Object.freeze({
      exactMainObserved: true,
      activeMainRulesetObserved: activeMain.length > 0,
      fullMainProtectionObserved: protectedMain,
      currentMainCiSuccess: currentHeadCiSuccess,
      standingAlwaysBypassObserved: alwaysBypass,
      zeroRequiredApprovalsObserved: zeroApproval,
      liveRuntimeProbed: false,
      sourceExfiltrationAllowed: false,
    }),
    findings: Object.freeze(findings),
    limitation: 'Repository/API observations only; no exploitation, cloud runtime acceptance, or authorization to mutate target.',
  });
}

/** Uses an injected GET-only transport so no write-capable adapter is needed. */
export async function observeSisterChallenge({ get } = {}) {
  if (typeof get !== 'function') refuse('sister-read-transport-required');
  const [challenger, target] = await Promise.all([
    get(ROOT + SISTER_CHALLENGER),
    get(ROOT + SISTER_TARGET),
  ]);
  if (challenger?.full_name !== SISTER_CHALLENGER ||
      target?.full_name !== SISTER_TARGET || target?.private !== true)
    refuse('sister-target-identity-rejected');
  const refPath = ROOT + SISTER_TARGET + '/git/ref/heads/main';
  const mainRef = await get(refPath);
  if (!SHA.test(mainRef?.object?.sha || '')) refuse('sister-main-sha-invalid');
  const list = await get(ROOT + SISTER_TARGET + '/rulesets?includes_parents=true');
  if (!Array.isArray(list) || list.length > 64) refuse('sister-ruleset-list-incomplete');
  const rulesets = [];
  for (const item of list) {
    if (item?.enforcement !== 'active') continue;
    if (!Number.isSafeInteger(item.id) || item.id <= 0)
      refuse('sister-ruleset-identity-invalid');
    rulesets.push(await get(ROOT + SISTER_TARGET + '/rulesets/' + item.id));
  }
  const runs = await get(ROOT + SISTER_TARGET +
    '/actions/runs?head_sha=' + mainRef.object.sha + '&per_page=50');
  if (!Array.isArray(runs?.workflow_runs))
    refuse('sister-actions-evidence-unavailable');
  const after = await get(refPath);
  if (after?.object?.sha !== mainRef.object.sha)
    refuse('sister-main-moved-retry-from-new-head');
  return evaluateSisterEvidence({
    challenger, target, mainRef, rulesets, workflowRuns: runs.workflow_runs,
  });
}

/** Safe to publish in a public repository: only fixed vocabulary leaves this module. */
export function renderSisterChallenge(result) {
  if (result?.schemaVersion !== 1 ||
      result?.kind !== 'ultron.sister-challenge.readonly' ||
      !Array.isArray(result?.findings)) refuse('sister-report-invalid');
  const fixedCodes = new Set([
    'sister-main-protection-unverified', 'sister-current-main-ci-unverified',
    'sister-governance-override-review', 'public-private-evidence-boundary',
    'live-owner-execution-not-tested',
  ]);
  if (result.findings.some(item => !fixedCodes.has(item.code) ||
      !['P1', 'P2'].includes(item.priority) ||
      !Object.values(FIXES).includes(item.repair)))
    refuse('sister-report-untrusted-findings');
  return [
    '# Ultron Sister Challenge — sanitized read-only findings',
    '',
    'Authority: authorized GitHub metadata reads only. Private source and exact target SHA intentionally omitted.',
    '',
    '| Priority | Finding | Patch proposal |',
    '| --- | --- | --- |',
    ...result.findings.map(item =>
      '| ' + item.priority + ' | ' + item.code + ' | ' + item.repair + ' |'),
    '',
    'Council: Sentinel (identity), Verifier (exact-head CI), Skeptic (uncertainty), Architect (repairs).',
    'Not tested: exploitation, account takeover, deployment, live runtime or target writes.',
    '',
  ].join('\n');
}
