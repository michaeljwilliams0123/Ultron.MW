import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateImprovementCandidate, summarizeLearningEvidence,
} from '../src/learning.mjs';

const SHA = 'a'.repeat(40);
const HASH = value => value.repeat(64);
const result = (score, overrides = {}) => ({
  status: 'succeeded', score, invariantsPassed: true, independentlyObserved: true,
  evidence: 'github-run-' + Math.round(score * 100), latencyMs: 100,
  costUsd: null, humanIntervention: false, ...overrides,
});
const cases = () => Array.from({ length: 8 }, (_, index) => ({
  id: 'case-' + index,
  split: index < 4 ? 'development' : 'heldout',
  critical: index === 4,
  baseline: result(.5),
  candidate: result(index < 4 ? .7 : .6),
}));
const candidate = (overrides = {}) => ({
  id: 'repo-review-v2', method: 'native', sourceSha: SHA,
  baselineArtifact: { kind: 'skill', id: 'repo-review', version: '1', sha256: HASH('b') },
  candidateArtifact: { kind: 'skill', id: 'repo-review', version: '2', sha256: HASH('c') },
  feedbackReceiptIds: ['receipt-1', 'receipt-2'],
  developmentCaseIds: ['case-0', 'case-1', 'case-2', 'case-3'],
  ...overrides,
});
const evaluator = (overrides = {}) => ({
  id: 'reef-heldout-evaluator',
  version: '1.0.0',
  sha256: HASH('e'),
  origin: 'protected-base',
  kind: 'deterministic-evaluator',
  ...overrides,
});

test('native candidate is selected only from independently observed held-out gains', () => {
  const report = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: cases(),
    evaluator: evaluator(),
  });
  assert.equal(report.disposition, 'Accepted');
  assert.equal(report.metrics.heldoutCases, 4);
  assert.equal(report.metrics.criticalRegressions, 0);
  assert.ok(report.metrics.candidateScore > report.metrics.baselineScore);
  assert.equal(report.publication, 'not-performed');
  assert.equal(report.releaseAuthority, 'github-protected-pr');
  const changed = cases();
  changed[7].candidate.score = .9;
  assert.notEqual(evaluateImprovementCandidate({
    candidate: candidate(),
    cases: changed,
    evaluator: evaluator(),
  }).fingerprint, report.fingerprint);
});

test('a critical regression rejects a candidate even when its average improves', () => {
  const benchmark = cases();
  benchmark[4].candidate = result(.4);
  benchmark[5].candidate = result(1);
  const report = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: benchmark,
    evaluator: evaluator(),
  });
  assert.equal(report.disposition, 'Rejected');
  assert.equal(report.metrics.criticalRegressions, 1);
});

test('candidate invariant failures reject while a repaired baseline invariant may improve', () => {
  const broken = cases();
  broken[5].candidate = result(.9, { invariantsPassed: false });
  assert.equal(evaluateImprovementCandidate({
    candidate: candidate(),
    cases: broken,
    evaluator: evaluator(),
  }).disposition, 'Rejected');
  const repaired = cases();
  repaired[5].baseline = result(.4, { invariantsPassed: false });
  repaired[5].candidate = result(.8);
  assert.equal(evaluateImprovementCandidate({
    candidate: candidate(),
    cases: repaired,
    evaluator: evaluator(),
  }).disposition, 'Accepted');
});

test('missing independent or terminal evidence is inconclusive, never a zero-risk pass', () => {
  const benchmark = cases();
  benchmark[6].candidate = result(.7, { status: 'incomplete', independentlyObserved: false });
  const report = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: benchmark,
    evaluator: evaluator(),
  });
  assert.equal(report.disposition, 'Inconclusive');
  assert.match(report.reason, /missing independently observed terminal evidence/);
});

test('independently observed candidate failure is rejected, while a repaired baseline failure may improve', () => {
  const failed = cases();
  failed[6].candidate = result(.7, { status: 'failed' });
  assert.equal(evaluateImprovementCandidate({
    candidate: candidate(),
    cases: failed,
    evaluator: evaluator(),
  }).disposition, 'Rejected');
  const repaired = cases();
  repaired[6].baseline = result(.2, { status: 'failed' });
  repaired[6].candidate = result(.7);
  assert.equal(evaluateImprovementCandidate({
    candidate: candidate(),
    cases: repaired,
    evaluator: evaluator(),
  }).disposition, 'Accepted');
});

test('unobserved latency and cost remain missing instead of becoming zero savings', () => {
  const benchmark = cases();
  benchmark[7].candidate = result(.7, { latencyMs: null, costUsd: null });
  const report = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: benchmark,
    evaluator: evaluator(),
  });
  assert.equal(report.disposition, 'Accepted');
  assert.equal(report.metrics.candidateMeanLatencyMs, null);
  assert.equal(report.metrics.candidateCostUsd, null);
});

test('Reef-assisted candidates are blocked without a verified real runtime record', () => {
  const report = evaluateImprovementCandidate({
    candidate: candidate({ method: 'reef-assisted', reef: { runtimeVerified: false } }),
    cases: cases(),
    evaluator: evaluator(),
  });
  assert.equal(report.disposition, 'Blocked');
  assert.match(report.reason, /Reef runtime/);
});

test('missing or candidate-origin evaluator is blocked against self-approval', () => {
  const missing = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: cases(),
  });
  assert.equal(missing.disposition, 'Blocked');
  assert.match(missing.reason, /independent evaluator identity/);

  const selfOrigin = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: cases(),
    evaluator: evaluator({ origin: 'candidate' }),
  });
  assert.equal(selfOrigin.disposition, 'Blocked');
  assert.match(selfOrigin.reason, /self-evaluate/);

  const sameHash = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: cases(),
    evaluator: evaluator({ sha256: HASH('c') }),
  });
  assert.equal(sameHash.disposition, 'Blocked');
  assert.match(sameHash.reason, /self-evaluate/);
});

test('v3 evaluation domains abstain without external ground truth and reject unverified claims', () => {
  const abstained = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: cases(),
    evaluator: evaluator(),
    domain: 'forecast-calibration',
    groundTruth: { source: 'synthetic' },
  });
  assert.equal(abstained.disposition, 'Inconclusive');
  assert.match(abstained.reason, /external ground truth/);

  const unverifiedClaim = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: cases(),
    evaluator: evaluator(),
    domain: 'scenario-reproducibility',
    groundTruth: { source: 'external' },
    claims: { humanResponseObserved: true },
  });
  assert.equal(unverifiedClaim.disposition, 'Rejected');
  assert.match(unverifiedClaim.reason, /Unverified/);

  const acceptedV3 = evaluateImprovementCandidate({
    candidate: candidate(),
    cases: cases(),
    evaluator: evaluator({ origin: 'external-independent' }),
    domain: 'generated-capability-safety',
    groundTruth: { source: 'external' },
  });
  assert.equal(acceptedV3.disposition, 'Accepted');
});

test('lineage rejects same-artifact and held-out leakage before scoring', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate({ candidateArtifact: {
      kind: 'skill', id: 'repo-review', version: '2', sha256: HASH('b'),
    } }),
    cases: cases(),
    evaluator: evaluator(),
  }), /distinct content/);
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate({ developmentCaseIds: ['case-0', 'case-4'] }),
    cases: cases(),
    evaluator: evaluator(),
  }), /held-out case/);
});

test('runtime learning summary uses the real experience and routing ledgers', () => {
  const summary = summarizeLearningEvidence({
    eligible: 19,
    experience: {
      active: { version: 'experience-abc' },
      assessments: [{ status: 'rejected' }, { status: 'validated' }],
      history: [{ action: 'promote' }, { action: 'rollback' }],
    },
    evolution: { accepted: 'routing-v2', evaluations: [{ passed: true }] },
  });
  assert.deepEqual(summary, {
    acceptedVersion: 'experience-abc', routingVersion: 'routing-v2',
    observationCount: 19, candidateCount: 3, promotionCount: 2,
  });
});
