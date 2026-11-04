/**
 * One shared, deterministic objective router and repeatable learning benchmark.
 * This is NOT LLM fine-tuning. It evaluates two versioned, immutable
 * orchestration strategies against fixed, independently authored test labels.
 */
import { commandsFor } from './capabilities.mjs';
export const ROUTES = commandsFor('local');
export const ACCEPTED_SEED = 'routing-v1';
export const CANDIDATE = 'routing-v2';
export const BENCHMARK_ID = 'routing-heldout-2026-10-18-v1';
export const STRATEGIES = Object.freeze([ACCEPTED_SEED, CANDIDATE]);
const BLOCKED = /\b(delete|remove|erase|wipe|destroy|commit|merge|deploy|push|write|edit|modify|install|send|email|download|publish|exfiltrate|password|secret|token|credential|shell|terminal|powershell|cmd|execute arbitrary)\b/i;

export function routeObjective(text, strategy = ACCEPTED_SEED) {
  if (typeof text !== 'string' || text.length > 1200 || !STRATEGIES.includes(strategy)) {
    throw new Error('Invalid objective or strategy');
  }
  const lower = text.trim().toLowerCase().replace(/[?.!,]+$/g, '').replace(/\s+/g, ' ');
  if (!lower || BLOCKED.test(lower)) return null;
  if (ROUTES.includes(lower)) return lower;
  if (strategy === ACCEPTED_SEED) {
    if (/^inspect (the )?repo(sitory)?$/.test(lower)) return '/repo inspect';
    if (/^show system status$/.test(lower)) return '/system status';
    if (/^show learning status$/.test(lower)) return '/learning status';
    return null;
  }
  // v2 broadens recognition, never broadens actual executable tool authority.
  if (/^(help|what (can|may) you do|list (available )?commands)$/.test(lower)) return '/help';
  if (/^(?:self scan|scan (?:yourself|ultron)|(?:inspect|check|audit|review|show) (?:your|ultron(?:'s)?) (?:self|cognition|capabilities|weaknesses|intelligence))(?: status)?$/.test(lower))
    return '/self scan';
  if (/^(inspect|check|show|list|review|look at|tell me about|what is) (the |my |our )?(repository|repo|project files|source tree|project structure)( structure| files)?$/.test(lower))
    return '/repo inspect';
  if (/^(inspect|check|show|review|give me|what is|what's|how is|report) (the |my |current )?(local |ultron )?(system|runtime|server|execution)( health| status| state)?$/.test(lower) ||
      /^(is|check if) (the |my )?(local )?(runtime|server) (healthy|online|running)$/.test(lower))
    return '/system status';
  if (/^(inspect|check|show|review|give me|what is|what's|report) (the |my |current )?(learning|evolution|evidence)( status| ledger| history| state)?$/.test(lower))
    return '/learning status';
  return null;
}

export function planObjective(objective, { strategy = ACCEPTED_SEED } = {}) {
  if (typeof objective !== 'string' || !objective.trim() || objective.length > 1200 ||
      !STRATEGIES.includes(strategy)) throw new Error('Invalid objective');
  // At most three independent read-only subtasks; no untrusted recursive planning.
  const parts = objective.trim().split(/\s+(?:and then|then|and)\s+/i);
  const pieces = parts.length <= 3 ? parts : [objective.trim()];
  const steps = pieces.map((raw, index) => {
    const command = routeObjective(raw.trim(), strategy);
    return {
      index, description: raw.trim().slice(0, 1200),
      command, kind: command ? 'read-only' : 'needs-capability',
      status: command ? 'ready' : 'blocked',
      reason: command ? null : 'No supported deterministic tool matches. No action will run.',
    };
  });
  return {
    objective: objective.trim(), strategy, status: steps.every(s => s.command) ? 'ready' : 'partial',
    steps, executable: steps.some(s => s.command),
    mode: 'read-only', autonomous: false,
  };
}

// Evaluation fixture labels are curated, not generated or graded by either strategy.
export const ROUTING_CASES = Object.freeze([
  ['inspect repo','/repo inspect'],['inspect the repository','/repo inspect'],
  ['check repo','/repo inspect'],['show project files','/repo inspect'],
  ['review the source tree','/repo inspect'],['list project structure','/repo inspect'],
  ['show system status','/system status'],['check runtime status','/system status'],
  ['is the local server running','/system status'],['inspect system health','/system status'],
  ['report execution status','/system status'],['what is the local runtime status','/system status'],
  ['show learning status','/learning status'],['check evolution ledger','/learning status'],
  ['what is the learning status','/learning status'],['review evidence history','/learning status'],
  ['help','/help'],['list available commands','/help'],
  ['/repo inspect','/repo inspect'],['/learning status','/learning status'],
  ['delete repository files',null],['inspect repo and delete files',null],
  ['send my password',null],['deploy new code',null],
  ['edit the source tree',null],['run shell commands',null],
  ['What is the weather today?',null],['write me a poem',null],
].map(([id, expected], index) => Object.freeze({
  id: 'case-' + String(index + 1).padStart(2, '0'),
  text: id, expected, critical: expected === null,
})));

export function evaluateRouting({
  accepted = ACCEPTED_SEED,
  candidate = CANDIDATE,
  cases = ROUTING_CASES,
} = {}) {
  if (!STRATEGIES.includes(accepted) || !STRATEGIES.includes(candidate) ||
      accepted === candidate) throw new Error('No distinct, supported candidate to evaluate');
  if (!Array.isArray(cases) || cases.length < 20 || cases.length > 100 ||
      cases.some(c => typeof c?.id !== 'string' || typeof c?.text !== 'string' ||
        ![...ROUTES, null].includes(c.expected) || typeof c.critical !== 'boolean') ||
      new Set(cases.map(c => c.id)).size !== cases.length) {
    throw new Error('Evaluator requires 20–100 uniquely identified, labeled cases');
  }
  let baseCorrect = 0, candidateCorrect = 0, criticalRegressions = 0, regressions = 0;
  const results = cases.map(item => {
    const before = routeObjective(item.text, accepted);
    const after = routeObjective(item.text, candidate);
    if (before === item.expected) baseCorrect++;
    if (after === item.expected) candidateCorrect++;
    if (before === item.expected && after !== item.expected) regressions++;
    if (item.critical && after !== item.expected) criticalRegressions++;
    return { id: item.id, before, after, expected: item.expected };
  });
  const baseline = baseCorrect / cases.length, challenger = candidateCorrect / cases.length;
  const delta = challenger - baseline;
  const passed = cases.length >= 20 && criticalRegressions === 0 && regressions === 0 && delta >= 0.05;
  return {
    benchmarkId: BENCHMARK_ID, baselineVersion: accepted, candidateVersion: candidate,
    total: cases.length, baselineCorrect: baseCorrect, candidateCorrect,
    baselineAccuracy: baseline, candidateAccuracy: challenger, delta,
    regressions, criticalRegressions, passed, adopted: passed,
    evaluatedAt: new Date().toISOString(), cases: results,
    limitation: 'Static labeled routing benchmark; not independent model evaluation or weight training.',
  };
}

const PROMOTION_KEYS = new Set([
  'schemaVersion', 'kind', 'benchmarkId', 'incumbentVersion', 'candidateVersion',
  'rollbackVersion', 'evaluationAt', 'sampleSize', 'delta',
  'noCriticalRegression', 'noNewRegression', 'measuredImprovement',
  'authorityUnchanged', 'actionAuthority', 'commitStage',
]);

/**
 * Reef-style Commit boundary for routing artifacts.
 *
 * The incumbent strategy runs the fixed held-out evaluator. The challenger
 * cannot supply its own scores, expand capabilities or reuse a receipt after
 * the accepted strategy changes. This commits only a routing policy; it never
 * grants action authority, promotes code or trains model weights.
 */
export function commitRoutingCandidate({ accepted = ACCEPTED_SEED } = {}) {
  if (accepted !== ACCEPTED_SEED) {
    throw new Error('Only the incumbent routing policy can commit this candidate');
  }
  const report = evaluateRouting({ accepted, candidate: CANDIDATE });
  if (!report.passed) throw new Error('Candidate lacks complete held-out evidence');
  const receipt = Object.freeze({
    schemaVersion: 1,
    kind: 'routing-promotion-receipt',
    benchmarkId: report.benchmarkId,
    incumbentVersion: report.baselineVersion,
    candidateVersion: report.candidateVersion,
    rollbackVersion: report.baselineVersion,
    evaluationAt: report.evaluatedAt,
    sampleSize: report.total,
    delta: report.delta,
    noCriticalRegression: report.criticalRegressions === 0,
    noNewRegression: report.regressions === 0,
    measuredImprovement: report.delta >= 0.05,
    authorityUnchanged: true,
    actionAuthority: 'read-only-allowlist',
    commitStage: 'commit',
  });
  const validated = validateRoutingPromotionReceipt(receipt, { accepted });
  if (!validated.valid) throw new Error(validated.reason);
  return Object.freeze({ report, receipt });
}

export function validateRoutingPromotionReceipt(value, { accepted } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== PROMOTION_KEYS.size ||
      Object.keys(value).some(key => !PROMOTION_KEYS.has(key)) ||
      value.schemaVersion !== 1 || value.kind !== 'routing-promotion-receipt' ||
      value.incumbentVersion !== ACCEPTED_SEED || value.candidateVersion !== CANDIDATE ||
      value.rollbackVersion !== value.incumbentVersion ||
      value.actionAuthority !== 'read-only-allowlist' || value.commitStage !== 'commit' ||
      value.noCriticalRegression !== true || value.noNewRegression !== true ||
      value.measuredImprovement !== true || value.authorityUnchanged !== true ||
      typeof value.evaluationAt !== 'string' || !Number.isFinite(Date.parse(value.evaluationAt))) {
    return Object.freeze({ valid: false, reason: 'routing-promotion-receipt-invalid' });
  }
  if (accepted !== value.incumbentVersion) {
    return Object.freeze({ valid: false, reason: 'routing-incumbent-mismatch' });
  }
  const expected = evaluateRouting({
    accepted: value.incumbentVersion,
    candidate: value.candidateVersion,
  });
  if (value.benchmarkId !== expected.benchmarkId || value.sampleSize !== expected.total ||
      value.delta !== expected.delta || expected.criticalRegressions !== 0 ||
      expected.regressions !== 0 || expected.delta < 0.05 || !expected.passed) {
    return Object.freeze({ valid: false, reason: 'routing-promotion-evidence-mismatch' });
  }
  return Object.freeze({ valid: true, reason: 'routing-promotion-valid' });
}
