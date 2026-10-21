import { createHash } from 'node:crypto';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const METHODS = new Set(['native', 'reef-assisted']);
const KINDS = new Set(['skill', 'harness']);
const STATUSES = new Set(['succeeded', 'failed', 'incomplete', 'ineligible']);

const fail = message => { throw new Error('Improvement evidence rejected: ' + message); };

function artifact(value, label) {
  if (!value || !KINDS.has(value.kind) || typeof value.id !== 'string' ||
      !value.id.trim() || typeof value.version !== 'string' || !value.version.trim() ||
      !SHA256.test(value.sha256 || '')) fail('invalid ' + label + ' artifact lineage');
  return { kind: value.kind, id: value.id, version: value.version,
    sha256: value.sha256 };
}

function observedResult(value, label) {
  if (!value || !STATUSES.has(value.status) || !Number.isFinite(value.score) ||
      value.score < 0 || value.score > 1 || typeof value.invariantsPassed !== 'boolean' ||
      typeof value.independentlyObserved !== 'boolean' ||
      typeof value.evidence !== 'string' || !value.evidence.trim() ||
      (value.latencyMs !== null && (!Number.isFinite(value.latencyMs) || value.latencyMs < 0)) ||
      (value.costUsd !== null && (!Number.isFinite(value.costUsd) || value.costUsd < 0)) ||
      typeof value.humanIntervention !== 'boolean') fail('invalid ' + label + ' result');
  return {
    status: value.status, score: value.score,
    invariantsPassed: value.invariantsPassed,
    independentlyObserved: value.independentlyObserved,
    evidence: value.evidence, latencyMs: value.latencyMs,
    costUsd: value.costUsd, humanIntervention: value.humanIntervention,
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Candidate selection only. Publishing still requires the protected GitHub PR
 * path and independent post-merge verification.
 */
export function evaluateImprovementCandidate({ candidate, cases } = {}) {
  if (!candidate || typeof candidate.id !== 'string' || !candidate.id.trim() ||
      !METHODS.has(candidate.method) || !SHA40.test(candidate.sourceSha || '') ||
      !Array.isArray(candidate.feedbackReceiptIds) || !candidate.feedbackReceiptIds.length ||
      candidate.feedbackReceiptIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(candidate.feedbackReceiptIds).size !== candidate.feedbackReceiptIds.length ||
      !Array.isArray(candidate.developmentCaseIds)) fail('invalid candidate identity or receipts');
  const baseline = artifact(candidate.baselineArtifact, 'baseline');
  const proposed = artifact(candidate.candidateArtifact, 'candidate');
  if (baseline.kind !== proposed.kind || baseline.id !== proposed.id)
    fail('candidate must replace the same versioned artifact');
  if (baseline.sha256 === proposed.sha256) fail('candidate requires distinct content');
  if (!Array.isArray(cases) || cases.length < 4) fail('at least four benchmark cases are required');

  const ids = new Set(), development = [], heldout = [];
  for (const item of cases) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) ||
        !['development', 'heldout'].includes(item.split) || typeof item.critical !== 'boolean')
      fail('invalid or duplicate benchmark case');
    ids.add(item.id);
    const normalized = {
      id: item.id, split: item.split, critical: item.critical,
      baseline: observedResult(item.baseline, item.id + ' baseline'),
      candidate: observedResult(item.candidate, item.id + ' candidate'),
    };
    (item.split === 'development' ? development : heldout).push(normalized);
  }
  if (development.length < 2 || heldout.length < 2)
    fail('separate development and held-out sets require at least two cases each');
  const declared = new Set(candidate.developmentCaseIds);
  if (declared.size !== candidate.developmentCaseIds.length ||
      candidate.developmentCaseIds.some(id => heldout.some(item => item.id === id)))
    fail('development evidence includes a held-out case');
  if (declared.size !== development.length || development.some(item => !declared.has(item.id)))
    fail('development case lineage is incomplete');

  const lineage = {
    sourceSha: candidate.sourceSha,
    baselineArtifact: { ...baseline }, candidateArtifact: { ...proposed },
    feedbackReceiptIds: [...candidate.feedbackReceiptIds],
  };
  const fingerprint = createHash('sha256').update(JSON.stringify({ lineage,
    cases: [...development, ...heldout] })).digest('hex');
  const base = {
    schema: 'ultron.improvement-disposition.v1', candidateId: candidate.id,
    method: candidate.method, lineage, fingerprint,
    publication: 'not-performed', releaseAuthority: 'github-protected-pr',
  };
  if (candidate.method === 'reef-assisted' &&
      (candidate.reef?.runtimeVerified !== true ||
       typeof candidate.reef?.recordId !== 'string' || !candidate.reef.recordId.trim())) {
    return { ...base, disposition: 'Blocked', metrics: null,
      reason: 'A Reef-assisted candidate requires a verified real Reef runtime record.' };
  }
  const isObservedTerminal = result => result.independentlyObserved &&
    ['succeeded', 'failed'].includes(result.status);
  if (heldout.some(item => !isObservedTerminal(item.baseline) ||
      !isObservedTerminal(item.candidate))) {
    return { ...base, disposition: 'Inconclusive', metrics: null,
      reason: 'Held-out comparison has missing independently observed terminal evidence.' };
  }

  const baselineScore = mean(heldout.map(item => item.baseline.score));
  const candidateScore = mean(heldout.map(item => item.candidate.score));
  const regressions = heldout.filter(item => item.candidate.score < item.baseline.score);
  const criticalRegressions = regressions.filter(item => item.critical);
  const improvements = heldout.filter(item => item.candidate.score > item.baseline.score);
  const candidateFailures = heldout.filter(item => item.candidate.status === 'failed');
  const invariantFailures = heldout.filter(item => !item.candidate.invariantsPassed);
  const observedMean = (side, key) => heldout.every(item =>
    Number.isFinite(item[side][key])) ? mean(heldout.map(item => item[side][key])) : null;
  const cost = side => heldout.every(item => item[side].costUsd !== null)
    ? heldout.reduce((sum, item) => sum + item[side].costUsd, 0) : null;
  const metrics = {
    developmentCases: development.length, heldoutCases: heldout.length,
    baselineScore, candidateScore, delta: candidateScore - baselineScore,
    improvements: improvements.length, regressions: regressions.length,
    criticalRegressions: criticalRegressions.length,
    candidateFailures: candidateFailures.length, invariantFailures: invariantFailures.length,
    baselineMeanLatencyMs: observedMean('baseline', 'latencyMs'),
    candidateMeanLatencyMs: observedMean('candidate', 'latencyMs'),
    baselineCostUsd: cost('baseline'), candidateCostUsd: cost('candidate'),
    humanInterventionCases: heldout.filter(item =>
      item.baseline.humanIntervention || item.candidate.humanIntervention).length,
  };
  if (candidateFailures.length || invariantFailures.length || criticalRegressions.length) {
    return { ...base, disposition: 'Rejected', metrics,
      reason: candidateFailures.length ? 'A held-out candidate run failed.' :
        invariantFailures.length ? 'An essential invariant failed.' :
          'A critical held-out benchmark case regressed.' };
  }
  if (!improvements.length || candidateScore <= baselineScore) {
    return { ...base, disposition: 'Rejected', metrics,
      reason: 'No independently measured targeted held-out improvement was demonstrated.' };
  }
  return { ...base, disposition: 'Accepted', metrics,
    reason: 'Selection policy passed; GitHub publication and post-release proof remain separate.' };
}

/** One status view over the ledgers that production actually writes. */
export function summarizeLearningEvidence({ eligible = 0, experience = {}, evolution = {} } = {}) {
  const assessments = Array.isArray(experience.assessments) ? experience.assessments : [];
  const evaluations = Array.isArray(evolution.evaluations) ? evolution.evaluations : [];
  const history = Array.isArray(experience.history) ? experience.history : [];
  return Object.freeze({
    acceptedVersion: experience.active?.version || 'baseline',
    routingVersion: evolution.accepted || 'routing-v1',
    observationCount: Number.isSafeInteger(eligible) && eligible >= 0 ? eligible : 0,
    candidateCount: assessments.length + evaluations.length,
    promotionCount: history.filter(item => item?.action === 'promote').length +
      evaluations.filter(item => item?.passed === true).length,
  });
}
