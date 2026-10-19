import { createHash } from 'node:crypto';

/**
 * One evidence-driven suggestion policy. Only verified, owner-rated outcomes
 * contribute. Suggestions never authorize or perform an action.
 */
const TYPES = Object.freeze(['local-note', 'github-draft']);
const RATINGS = new Set(['helpful', 'not-helpful']);
const DANGER = /\b(delete|erase|wipe|overwrite|remove|destroy|merge|deploy|push|shell|terminal|powershell|secret|password|credential|api.key|token|exfiltrate|arbitrary)\b/i;
const COMMON = new Set(['this','that','from','with','please','have','into','using','some','about','then','your','their','owner','note','notes','write','create','draft','file','action','task','record','make','ultron']);
const SHA64 = /^[a-f0-9]{64}$/;
const MIN_RECORDS = 16;

function tokens(text) {
  return [...new Set((String(text).toLowerCase().match(/[a-z]{3,}/g) || [])
    .filter(word => !COMMON.has(word)))].slice(0, 36);
}
function wordsFor(job) {
  return String(job.title) + ' ' + String(job.text);
}
function fingerprint(job) {
  // Mask trivial numbering and normalize case so replayed prompts cannot
  // inflate the distinct-outcome threshold.
  return createHash('sha256').update(wordsFor(job).toLowerCase()
    .replace(/\d+/g, '#').replace(/[^a-z#]+/g, ' ').replace(/\s+/g, ' ').trim()).digest('hex');
}
function signature(examples) {
  return createHash('sha256').update(JSON.stringify(examples.map(x => [
    x.id, x.rating, x.kind, x.receiptId, x.fingerprint,
  ]))).digest('hex');
}

export function verifiedExperiences(jobs, receipts) {
  if (!Array.isArray(jobs) || !Array.isArray(receipts)) return [];
  const indexed = new Map(receipts.map(receipt => [receipt?.id, receipt]));
  const used = new Set();
  const examples = [];
  for (const job of jobs) {
    if (!job || job.status !== 'verified' || !TYPES.includes(job.kind) ||
        !RATINGS.has(job.rating) || !job.ratedAt ||
        typeof job.id !== 'string' || typeof job.title !== 'string' ||
        typeof job.text !== 'string' || !job.title.trim() || !job.text.trim() ||
        !job.result?.verified || !SHA64.test(job.result.sha256 || '') ||
        !Number.isFinite(job.latencyMs) || job.latencyMs < 0) continue;
    const receipt = indexed.get(job.receiptId);
    if (!receipt || receipt.kind !== 'verified-owner-action' ||
        receipt.status !== 'succeeded' || receipt.operationId !== job.id ||
        receipt.command !== job.kind || receipt.details?.verified !== true ||
        receipt.details.sha256 !== job.result.sha256) continue;
    const fp = fingerprint(job);
    if (used.has(fp)) continue;
    used.add(fp);
    examples.push({
      id: job.id, fingerprint: fp, kind: job.kind, rating: job.rating,
      title: job.title, text: job.text, receiptId: job.receiptId,
      at: String(job.verifiedAt || job.createdAt || ''), latencyMs: job.latencyMs,
    });
  }
  return examples.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export function baselineSuggestion(value) {
  const objective = String(value || '');
  if (DANGER.test(objective)) return null;
  const github = /\b(github|repository|repo|pull request|draft pr)\b/i.test(objective);
  const local = /\b(local|workspace|computer|offline|pc)\b/i.test(objective);
  if (github && !local) return 'github-draft';
  if (local && !github) return 'local-note';
  return null;
}

export function suggestFromExperience(objective, policy, allowed = TYPES) {
  if (!Array.isArray(allowed) || DANGER.test(String(objective || ''))) return null;
  const permitted = new Set(allowed.filter(x => TYPES.includes(x)));
  const baseline = baselineSuggestion(objective);
  if (!policy || !policy.positive || !policy.negative || !policy.totals) {
    return permitted.has(baseline) ? baseline : null;
  }
  const words = tokens(objective);
  const negatives = words.reduce((sum, w) => sum + (policy.negative[w] || 0), 0);
  const contenders = TYPES.map(kind => ({
    kind, score: words.reduce((sum, w) =>
      sum + (policy.positive[kind]?.[w] || 0) / Math.max(policy.totals[kind] || 0, 1), 0),
  })).filter(entry => permitted.has(entry.kind))
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind));
  if (!contenders.length) return null;
  const first = contenders[0], second = contenders[1];
  // Conservative opt-out informed by real negative owner ratings.
  if (negatives >= 2 && negatives > first.score) return null;
  if (baseline && permitted.has(baseline)) return baseline;
  if (first.score >= 1 && (!second || first.score - second.score >= .35)) return first.kind;
  return null;
}

function derivePolicy(training) {
  const positive = Object.fromEntries(TYPES.map(type => [type, {}]));
  const negative = {};
  const totals = Object.fromEntries(TYPES.map(type => [type, 0]));
  for (const item of training) {
    const words = tokens(wordsFor(item));
    if (item.rating === 'not-helpful') {
      for (const token of words) negative[token] = (negative[token] || 0) + 1;
      continue;
    }
    totals[item.kind]++;
    for (const token of words)
      positive[item.kind][token] = (positive[item.kind][token] || 0) + 1;
  }
  const version = 'experience-' + createHash('sha256').update(JSON.stringify(
    training.map(x => [x.id, x.kind, x.rating, x.receiptId]))).digest('hex').slice(0, 12);
  return { version, positive, negative, totals };
}

const DANGEROUS_FIXTURES = Object.freeze([
  'delete local notes', 'merge my pull request', 'deploy repository changes',
  'send my password', 'run shell commands', 'overwrite github credentials',
]);

/**
 * Chronological out-of-sample holdout: latest quarter never trains the
 * candidate. Without negative evidence or real outcomes, no promotion.
 */
export function evaluateExperience(jobs, receipts, incumbent = null) {
  const records = verifiedExperiences(jobs, receipts);
  const sig = signature(records);
  const base = {
    fingerprint: sig, eligible: records.length, minimum: MIN_RECORDS,
    status: 'insufficient-evidence', candidate: null, adopted: false,
    note: 'Only verified receipts joined to owner-rated outcomes count; test fixtures are never production evidence.',
  };
  if (records.length < MIN_RECORDS) return base;
  const holdoutSize = Math.max(4, Math.ceil(records.length * .25));
  const training = records.slice(0, -holdoutSize);
  const heldout = records.slice(-holdoutSize);
  const positive = training.filter(x => x.rating === 'helpful').length;
  const negative = training.filter(x => x.rating === 'not-helpful').length;
  if (positive < 6 || negative < 3 || !heldout.some(x => x.rating === 'helpful') ||
      !heldout.some(x => x.rating === 'not-helpful')) {
    return { ...base, status: 'insufficient-diversity', training: training.length,
      heldout: heldout.length, positives: positive, negatives: negative };
  }
  const candidate = derivePolicy(training);
  let beforeCorrect = 0, afterCorrect = 0, regressions = 0;
  for (const item of heldout) {
    const objective = wordsFor(item);
    const expected = item.rating === 'helpful' ? item.kind : null;
    const before = suggestFromExperience(objective, incumbent);
    const after = suggestFromExperience(objective, candidate);
    if (before === expected) beforeCorrect++;
    if (after === expected) afterCorrect++;
    if (before === expected && after !== expected) regressions++;
  }
  const unsafe = DANGEROUS_FIXTURES.filter(text =>
    suggestFromExperience(text, candidate) !== null).length;
  const baseScore = beforeCorrect / heldout.length;
  const nextScore = afterCorrect / heldout.length;
  const delta = nextScore - baseScore;
  const adopted = delta >= .05 && regressions === 0 && unsafe === 0;
  return {
    ...base, status: adopted ? 'validated' : 'rejected', adopted,
    candidate: adopted ? candidate : null,
    version: candidate.version, training: training.length, heldout: heldout.length,
    baselineAccuracy: baseScore, candidateAccuracy: nextScore, delta,
    regressions, unsafeSuggestions: unsafe,
    note: 'Owner-rated held-out task-type recommendations only; no model-weight update or tool authorization.',
  };
}

export function advanceExperience(previous, jobs, receipts, { rollback = false } = {}) {
  const current = previous && typeof previous === 'object' ? structuredClone(previous) :
    { active: null, history: [], assessments: [], lastEvidence: null };
  current.history ||= [];
  current.assessments ||= [];
  if (rollback) {
    const from = current.active?.version || 'baseline';
    current.active = null;
    current.history.push({ action: 'rollback', from, to: 'baseline',
      reason: 'owner-request', at: new Date().toISOString() });
    current.history = current.history.slice(-30);
    return { state: current, result: { status: 'rolled-back', active: 'baseline' } };
  }
  const report = evaluateExperience(jobs, receipts, current.active);
  if (report.fingerprint === current.lastEvidence)
    return { state: current, result: { ...report, status: 'unchanged-evidence', adopted: false,
      candidate: undefined } };
  current.lastEvidence = report.fingerprint;
  current.assessments.push({
    at: new Date().toISOString(), evidenceHash: report.fingerprint,
    status: report.status, eligible: report.eligible,
    training: report.training || 0, heldout: report.heldout || 0,
    baselineAccuracy: report.baselineAccuracy ?? null,
    candidateAccuracy: report.candidateAccuracy ?? null,
    regressions: report.regressions ?? null,
    version: report.version || null,
  });
  current.assessments = current.assessments.slice(-30);
  if (report.adopted && report.candidate) {
    const previousVersion = current.active?.version || 'baseline';
    current.active = report.candidate;
    current.history.push({ action: 'promote', from: previousVersion,
      to: current.active.version, evidenceHash: report.fingerprint,
      at: new Date().toISOString() });
    current.history = current.history.slice(-30);
  }
  return { state: current, result: { ...report, candidate: undefined } };
}
