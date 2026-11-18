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

// 34 advanced, unique, and purposely confusing edge-case tests (#173)
test('edge 01: council-advice evaluator kind is blocked even with external-independent origin', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ origin: 'external-independent', kind: 'council-advice' }),
  });
  assert.equal(r.disposition, 'Blocked');
  assert.match(r.reason, /advisory only/);
});

test('edge 02: evaluator sharing baseline artifact sha256 with protected-base origin is allowed', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ sha256: HASH('b'), origin: 'protected-base' }),
  });
  assert.equal(r.disposition, 'Accepted');
});

test('edge 03: evaluator with uppercase hex sha256 is rejected', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ sha256: 'E'.repeat(64) }),
  }), /invalid evaluator identity/);
});

test('edge 04: evaluator with whitespace-only id or version is rejected', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ id: '   ' }),
  }), /invalid evaluator identity/);
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ version: '\t\n' }),
  }), /invalid evaluator identity/);
});

test('edge 05: evaluator with unknown origin or kind throws invalid evaluator identity', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ origin: 'self-certified' }),
  }), /invalid evaluator identity/);
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ kind: 'llm-judge' }),
  }), /invalid evaluator identity/);
});

test('edge 06: evaluator passed as primitive string or array throws invalid evaluator identity', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(), evaluator: 'reef-eval',
  }), /invalid evaluator identity/);
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(), evaluator: [],
  }), /invalid evaluator identity/);
});

test('edge 07: null evaluator is treated as missing and returns Blocked', () => {
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: cases(), evaluator: null });
  assert.equal(r.disposition, 'Blocked');
});

test('edge 08: unknown v3 domain throws unsupported evaluation domain', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(), evaluator: evaluator(),
    domain: 'autonomous-merge', groundTruth: { source: 'external' },
  }), /unsupported evaluation domain/);
});

test('edge 09: all four v3 domains abstain when groundTruth is missing or non-external', () => {
  for (const domain of ['forecast-calibration', 'scenario-reproducibility', 'portfolio-policy', 'generated-capability-safety']) {
    const r = evaluateImprovementCandidate({
      candidate: candidate(), cases: cases(), evaluator: evaluator(), domain,
    });
    assert.equal(r.disposition, 'Inconclusive');
  }
});

test('edge 10: humanReviewed claim rejected for deterministic-evaluator even with external groundTruth', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ kind: 'deterministic-evaluator' }),
    groundTruth: { source: 'external' },
    claims: { humanReviewed: true },
  });
  assert.equal(r.disposition, 'Rejected');
});

test('edge 11: humanReviewed claim accepted when evaluator kind is independent-reviewer', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(),
    evaluator: evaluator({ origin: 'external-independent', kind: 'independent-reviewer' }),
    groundTruth: { source: 'external' },
    claims: { humanReviewed: true },
  });
  assert.equal(r.disposition, 'Accepted');
});

test('edge 12: humanResponseObserved claim accepted only when groundTruth confirms it', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(), evaluator: evaluator(),
    domain: 'scenario-reproducibility',
    groundTruth: { source: 'external', humanResponseObserved: true },
    claims: { humanResponseObserved: true },
  });
  assert.equal(r.disposition, 'Accepted');
});

test('edge 13: modelWeightsTrained and reefHarnessOptimized claims always reject even with external groundTruth', () => {
  for (const claims of [{ modelWeightsTrained: true }, { reefHarnessOptimized: true }]) {
    const r = evaluateImprovementCandidate({
      candidate: candidate(), cases: cases(), evaluator: evaluator(),
      groundTruth: { source: 'external', humanResponseObserved: true, modelCreditVerified: true },
      claims,
    });
    assert.equal(r.disposition, 'Rejected');
  }
});

test('edge 14: modelCredit claim rejected without modelCreditVerified=true in groundTruth', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(), evaluator: evaluator(),
    groundTruth: { source: 'external', modelCreditVerified: false },
    claims: { modelCredit: true },
  });
  assert.equal(r.disposition, 'Rejected');
});

test('edge 15: modelCredit claim accepted when groundTruth.modelCreditVerified=true', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate(), cases: cases(), evaluator: evaluator(),
    groundTruth: { source: 'external', modelCreditVerified: true },
    claims: { modelCredit: true },
  });
  assert.equal(r.disposition, 'Accepted');
});

test('edge 16: reef-assisted candidate with whitespace-only recordId is Blocked', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate({ method: 'reef-assisted', reef: { runtimeVerified: true, recordId: '   ' } }),
    cases: cases(), evaluator: evaluator(),
  });
  assert.equal(r.disposition, 'Blocked');
});

test('edge 17: reef-assisted candidate with valid recordId and runtimeVerified=true is Accepted', () => {
  const r = evaluateImprovementCandidate({
    candidate: candidate({ method: 'reef-assisted', reef: { runtimeVerified: true, recordId: 'reef-run-42' } }),
    cases: cases(), evaluator: evaluator(),
  });
  assert.equal(r.disposition, 'Accepted');
});

test('edge 18: development failures do not block acceptance when held-out improves cleanly', () => {
  const c = cases();
  for (let i = 0; i < 4; i++) c[i].candidate = result(0, { status: 'failed', invariantsPassed: false });
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Accepted');
});

test('edge 19: non-critical held-out regression still accepts if net average and improvements hold', () => {
  const c = cases();
  c[4].candidate = result(0.5); // critical tie (not regression)
  c[5].candidate = result(0.45); // non-critical regression
  c[6].candidate = result(0.95);
  c[7].candidate = result(0.95);
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Accepted');
  assert.equal(r.metrics.regressions, 1);
  assert.equal(r.metrics.criticalRegressions, 0);
});

test('edge 20: microscopic critical held-out regression (1e-12) rejects candidate', () => {
  const c = cases();
  c[4].baseline = result(0.5);
  c[4].candidate = result(0.5 - 1e-12);
  c[5].candidate = result(1.0);
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Rejected');
  assert.equal(r.metrics.criticalRegressions, 1);
});

test('edge 21: exact tie on all held-out cases is Rejected (no improvement demonstrated)', () => {
  const c = cases();
  for (let i = 4; i < 8; i++) { c[i].baseline = result(0.7); c[i].candidate = result(0.7); }
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Rejected');
  assert.equal(r.metrics.improvements, 0);
});

test('edge 22: one improved held-out case offset by larger non-critical regression yields delta <= 0 and Rejects', () => {
  const c = cases();
  c[4].candidate = result(0.5); // critical tie
  c[5].candidate = result(0.6); // +0.1
  c[6].candidate = result(0.2); // -0.3
  c[7].candidate = result(0.5); // tie
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Rejected');
  assert.equal(r.metrics.improvements, 1);
  assert.ok(r.metrics.delta < 0);
});

test('edge 23: floating-point trap 0.1 + 0.2 baseline vs 0.3 candidate is Rejected not Accepted', () => {
  const c = cases();
  for (let i = 4; i < 8; i++) {
    c[i].baseline = result(0.1 + 0.2);
    c[i].candidate = result(0.3);
  }
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Rejected');
});

test('edge 24: held-out baseline ineligible returns Inconclusive even when candidate succeeds', () => {
  const c = cases();
  c[4].baseline = result(0.5, { status: 'ineligible' });
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Inconclusive');
});

test('edge 25: held-out baseline independentlyObserved=false returns Inconclusive', () => {
  const c = cases();
  c[7].baseline = result(0.5, { independentlyObserved: false });
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Inconclusive');
});

test('edge 26: evaluator change alters deterministic fingerprint', () => {
  const r1 = evaluateImprovementCandidate({ candidate: candidate(), cases: cases(), evaluator: evaluator({ id: 'eval-a' }) });
  const r2 = evaluateImprovementCandidate({ candidate: candidate(), cases: cases(), evaluator: evaluator({ id: 'eval-b' }) });
  assert.notEqual(r1.fingerprint, r2.fingerprint);
});

test('edge 27: duplicate feedbackReceiptIds throws invalid candidate identity', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate({ feedbackReceiptIds: ['r1', 'r1'] }),
    cases: cases(), evaluator: evaluator(),
  }), /invalid candidate identity/);
});

test('edge 28: cross-kind artifact replacement (skill -> harness) is rejected', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate({ candidateArtifact: { kind: 'harness', id: 'repo-review', version: '2', sha256: HASH('c') } }),
    cases: cases(), evaluator: evaluator(),
  }), /same versioned artifact/);
});

test('edge 29: cross-id artifact replacement is rejected', () => {
  assert.throws(() => evaluateImprovementCandidate({
    candidate: candidate({ candidateArtifact: { kind: 'skill', id: 'other-skill', version: '2', sha256: HASH('c') } }),
    cases: cases(), evaluator: evaluator(),
  }), /same versioned artifact/);
});

test('edge 30: negative or NaN latencyMs / costUsd throws invalid result', () => {
  for (const bad of [{ latencyMs: -1 }, { latencyMs: NaN }, { costUsd: -0.01 }, { costUsd: Infinity }]) {
    const c = cases();
    c[4].candidate = result(0.8, bad);
    assert.throws(() => evaluateImprovementCandidate({
      candidate: candidate(), cases: c, evaluator: evaluator(),
    }), /invalid case-4 candidate result/);
  }
});

test('edge 31: score out of [0, 1] or NaN throws invalid result', () => {
  for (const score of [-0.001, 1.001, NaN, Infinity]) {
    const c = cases();
    c[5].baseline = result(0.5, { score });
    assert.throws(() => evaluateImprovementCandidate({
      candidate: candidate(), cases: c, evaluator: evaluator(),
    }), /invalid case-5 baseline result/);
  }
});

test('edge 32: humanInterventionCases counts both baseline and candidate interventions without double-counting same case', () => {
  const c = cases();
  c[4].baseline = result(0.5, { humanIntervention: true });
  c[4].candidate = result(0.6, { humanIntervention: true });
  c[5].candidate = result(0.6, { humanIntervention: true });
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.disposition, 'Accepted');
  assert.equal(r.metrics.humanInterventionCases, 2);
});

test('edge 33: observed baseline and candidate costs sum accurately when all held-out cases report numeric costUsd', () => {
  const c = cases();
  for (let i = 4; i < 8; i++) {
    c[i].baseline = result(0.5, { costUsd: 0.25 });
    c[i].candidate = result(0.7, { costUsd: 0.1 });
  }
  const r = evaluateImprovementCandidate({ candidate: candidate(), cases: c, evaluator: evaluator() });
  assert.equal(r.metrics.baselineCostUsd, 1);
  assert.ok(Math.abs(r.metrics.candidateCostUsd - 0.4) < 1e-9);
});

test('edge 34: summarizeLearningEvidence ignores negative or non-integer eligible counts and missing objects', () => {
  assert.deepEqual(summarizeLearningEvidence({ eligible: -5 }), {
    acceptedVersion: 'baseline', routingVersion: 'routing-v1',
    observationCount: 0, candidateCount: 0, promotionCount: 0,
  });
  assert.deepEqual(summarizeLearningEvidence({ eligible: 3.5 }), {
    acceptedVersion: 'baseline', routingVersion: 'routing-v1',
    observationCount: 0, candidateCount: 0, promotionCount: 0,
  });
});
