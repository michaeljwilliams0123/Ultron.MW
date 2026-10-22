import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SISTER_CHALLENGER, SISTER_TARGET, evaluateSisterEvidence,
  observeSisterChallenge, renderSisterChallenge,
} from '../src/sister-challenge.mjs';

const MAIN = 'a'.repeat(40);
const challenger = { full_name: SISTER_CHALLENGER, private: false, default_branch: 'main' };
const target = { full_name: SISTER_TARGET, private: true, default_branch: 'main' };
const mainRef = { object: { sha: MAIN } };
const ruleset = {
  id: 42, enforcement: 'active', target: 'branch',
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  bypass_actors: [{ bypass_mode: 'always' }],
  rules: [
    { type: 'deletion' }, { type: 'non_fast_forward' },
    { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
    { type: 'required_status_checks', parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [
        { context: 'Verify (ubuntu-latest)' }, { context: 'Verify (windows-latest)' },
      ],
    } },
  ],
};
const verified = { head_sha: MAIN, name: 'Verify Mahoraga',
  status: 'completed', conclusion: 'success', run_number: 3 };
function evaluate(override = {}) {
  return evaluateSisterEvidence({ challenger, target, mainRef,
    rulesets: [ruleset], workflowRuns: [verified], ...override });
}

test('exact-main governance is independently observed without claiming runtime control', () => {
  const result = evaluate();
  assert.equal(result.evidence.fullMainProtectionObserved, true);
  assert.equal(result.evidence.currentMainCiSuccess, true);
  assert.equal(result.evidence.liveRuntimeProbed, false);
  assert.ok(result.findings.some(x => x.code === 'sister-governance-override-review'));
  assert.ok(result.findings.some(x => x.code === 'public-private-evidence-boundary'));
});

test('missing or weak ruleset cannot produce protection acceptance', () => {
  for (const rulesets of [[], [{ ...ruleset, rules: ruleset.rules.slice(0, -1) }],
    [{ ...ruleset, enforcement: 'disabled' }]]) {
    const report = evaluate({ rulesets });
    assert.ok(report.findings.some(x => x.code === 'sister-main-protection-unverified'));
    assert.equal(report.evidence.fullMainProtectionObserved, false);
  }
});

test('latest exact-main workflow evidence must be green', () => {
  for (const workflowRuns of [[], [{ ...verified, head_sha: 'b'.repeat(40) }],
    [{ ...verified, conclusion: 'skipped' }],
    [verified, { ...verified, run_number: 4, conclusion: 'failure' }]]) {
    const report = evaluate({ workflowRuns });
    assert.equal(report.evidence.currentMainCiSuccess, false);
    assert.ok(report.findings.some(x => x.code === 'sister-current-main-ci-unverified'));
  }
});

test('wrong identity or privacy boundary fails closed', () => {
  assert.throws(() => evaluate({ target: { ...target, private: false } }), /sister-read-evidence-invalid/);
  assert.throws(() => evaluate({ challenger: { ...challenger, full_name: SISTER_TARGET } }), /sister-read-evidence-invalid/);
  assert.throws(() => evaluate({ mainRef: { object: { sha: 'not-a-sha' } } }), /sister-read-evidence-invalid/);
});

test('read-only observer requires stable head and reads no private code', async () => {
  const paths = [];
  const root = '/repos/' + SISTER_TARGET;
  const get = async path => {
    paths.push(path);
    if (path === '/repos/' + SISTER_CHALLENGER) return challenger;
    if (path === root) return target;
    if (path === root + '/git/ref/heads/main') return mainRef;
    if (path === root + '/rulesets?includes_parents=true&per_page=100') return [ruleset];
    if (path === root + '/rulesets/42') return ruleset;
    if (path.startsWith(root + '/actions/runs?head_sha=')) return { workflow_runs: [verified] };
    throw Error('Unexpected data request');
  };
  const value = await observeSisterChallenge({ get });
  assert.equal(value.targetVerified, true);
  assert.ok(paths.every(path => !path.includes('/contents/') && !path.includes('/git/blobs/')));
  let reads = 0;
  await assert.rejects(() => observeSisterChallenge({ get: async path => {
    if (path === '/repos/' + SISTER_CHALLENGER) return challenger;
    if (path === root) return target;
    if (path === root + '/git/ref/heads/main')
      return { object: { sha: (++reads === 1 ? MAIN : 'b'.repeat(40)) } };
    if (path === root + '/rulesets?includes_parents=true&per_page=100') return [];
    if (path.startsWith(root + '/actions/runs?')) return { workflow_runs: [] };
    throw Error('Unexpected request');
  } }), /sister-main-moved-retry-from-new-head/);
});

test('rendered report cannot disclose private API content or injected strings', () => {
  const report = evaluate({ target: { ...target, private: true, injected: 'PRIVATE_API_PAYLOAD' } });
  const safe = renderSisterChallenge(report);
  assert.doesNotMatch(safe, /PRIVATE_API_PAYLOAD/);
  assert.doesNotMatch(safe, new RegExp(MAIN));
  assert.match(safe, /read-only findings/);
  assert.throws(() => renderSisterChallenge({
    ...report, findings: [{ priority: 'P1', code: 'PRIVATE_API_PAYLOAD', repair: 'secret' }],
  }), /sister-report-untrusted-findings/);
});

test('ruleset collection fails closed on a full page rather than silently accepting partial protection evidence', async () => {
  const root = '/repos/' + SISTER_TARGET;
  const requests = [];
  const get = async path => {
    requests.push(path);
    if (path === '/repos/' + SISTER_CHALLENGER) return challenger;
    if (path === root) return target;
    if (path === root + '/git/ref/heads/main') return mainRef;
    if (path === root + '/rulesets?includes_parents=true&per_page=100') {
      return Array.from({ length: 100 }, (_, id) => ({ id: id + 1, enforcement: 'disabled' }));
    }
    throw Error('Unexpected request after full ruleset page');
  };
  await assert.rejects(() => observeSisterChallenge({ get }), /sister-ruleset-list-incomplete/);
  assert.ok(requests.includes(root + '/rulesets?includes_parents=true&per_page=100'));
  assert.ok(!requests.some(path => path.includes('/actions/runs?')));
});
