import { createHash } from 'node:crypto';

import { commandsFor } from '../docs/core/capabilities.mjs';
import { assessMetacognition } from './metacognition.mjs';
import { simulateCounterfactual } from './cognitive-world-model.mjs';
import { createCognitiveIndividual } from './cognitive-individual.mjs';
import {
  createCollectivePosition,
  selectCollectiveParticipants,
  synthesizeCollectiveDeliberation,
} from './collective-cognition.mjs';

const PLAN_KEYS = new Set([
  'objective', 'strategy', 'status', 'steps', 'executable', 'mode', 'autonomous',
]);
const STEP_KEYS = new Set([
  'index', 'description', 'command', 'kind', 'status', 'reason',
]);
const OPTIONS_KEYS = new Set([
  'evidenceCoverage', 'calibratedConfidence', 'knownUnknowns',
  'materialConflictCount', 'observedAt',
]);
const ROUTES = new Set(commandsFor('local'));

/**
 * Always-on multi-self GrokBot cognitive council for Ultron plans (7 fixed selves).
 *
 * The council provides a falsifiable mental model: evidence calibration,
 * counterfactual uncertainty and preserved dissent. It is advisory and cannot
 * grant capabilities, execute a plan, invoke a model, spend credits or promote
 * its own policy.
 */
export function deliberatePlan(planInput, optionsInput = {}) {
  const plan = normalizePlan(planInput);
  const options = normalizeOptions(optionsInput);
  const participants = createCouncil(options.observedAt);
  const ready = plan.steps.filter(step => step.status === 'ready' && step.command);
  const blocked = plan.steps.filter(step => step.status !== 'ready' || !step.command);
  const capabilitySafe = ready.every(step => step.kind === 'read-only' && ROUTES.has(step.command));
  const complete = plan.status === 'ready' && blocked.length === 0 &&
    plan.executable === true && capabilitySafe;
  const metacognition = assessMetacognition({
    evidenceCoverage: options.evidenceCoverage,
    calibratedConfidence: options.calibratedConfidence,
    knownUnknowns: options.knownUnknowns,
    materialConflictCount: options.materialConflictCount,
    reversible: true,
  });
  const planFingerprint = digest(plan);
  const evidenceRefs = [
    `plan:sha256:${planFingerprint}`,
    'registry:ultron-capabilities-v1',
  ];
  const hold = !complete || !metacognition.proceed;
  const assumptions = complete ? ['read-only-capabilities-remain-current'] : [];
  const positions = [
    createCollectivePosition({
      individualId: 'ultron-builder',
      conclusion: complete ? 'proceed' : 'hold',
      confidence: options.evidenceCoverage,
      evidenceRefs,
      assumptions,
      unknowns: options.knownUnknowns,
      dissentTags: complete ? [] : ['unsupported-capability'],
    }),
    createCollectivePosition({
      individualId: 'ultron-steward',
      conclusion: metacognition.proceed ? 'proceed' : 'hold',
      confidence: options.calibratedConfidence,
      evidenceRefs: [...evidenceRefs, `metacognition:sha256:${metacognition.fingerprint}`],
      assumptions,
      unknowns: metacognition.knownUnknowns,
      dissentTags: metacognition.proceed ? [] : ['evidence-gap'],
    }),
    createCollectivePosition({
      individualId: 'ultron-skeptic',
      conclusion: hold ? 'hold' : 'proceed',
      confidence: hold ? Math.max(0.8, options.calibratedConfidence) :
        Math.min(0.79, options.calibratedConfidence),
      evidenceRefs,
      assumptions: [],
      unknowns: metacognition.knownUnknowns,
      dissentTags: hold ? [complete ? 'evidence-gap' : 'unsupported-capability'] : [],
    }),
    createCollectivePosition({
      individualId: 'ultron-predictor',
      conclusion: complete && metacognition.proceed ? 'proceed' : 'hold',
      confidence: Number((options.calibratedConfidence * 0.95).toFixed(6)),
      evidenceRefs: [...evidenceRefs, 'counterfactual:active'],
      assumptions,
      unknowns: options.knownUnknowns,
      dissentTags: complete ? [] : ['outcome-uncertain'],
    }),
    createCollectivePosition({
      individualId: 'ultron-generator',
      conclusion: complete ? 'proceed' : 'hold',
      confidence: Number(Math.min(0.92, options.evidenceCoverage + 0.05).toFixed(6)),
      evidenceRefs,
      assumptions,
      unknowns: options.knownUnknowns,
      dissentTags: complete ? [] : ['no-generative-path'],
    }),
    createCollectivePosition({
      individualId: 'ultron-sentinel',
      conclusion: hold ? 'hold' : 'proceed',
      confidence: hold ? 0.88 : 0.82,
      evidenceRefs,
      assumptions: [],
      unknowns: metacognition.knownUnknowns,
      dissentTags: hold ? ['watch-alert'] : [],
    }),
    createCollectivePosition({
      individualId: 'ultron-companion',
      conclusion: complete && metacognition.proceed ? 'proceed' : 'hold',
      confidence: options.calibratedConfidence,
      evidenceRefs,
      assumptions: ['owner-sovereignty-intact'],
      unknowns: options.knownUnknowns,
      dissentTags: complete ? [] : ['awaiting-owner-clarity'],
    }),
  ];
  const deliberation = synthesizeCollectiveDeliberation({ positions });
  const stateUncertainty = Number(Math.min(1,
    (options.knownUnknowns.length + options.materialConflictCount) / 32).toFixed(6));
  const counterfactual = simulateCounterfactual({
    observedState: {
      blockedSteps: blocked.length,
      evidenceCoverage: options.evidenceCoverage,
      readySteps: ready.length,
    },
    stateUncertainty,
    action: {
      actionId: 'attempt-bounded-plan',
      effects: {},
      uncertainty: Number((1 - options.evidenceCoverage).toFixed(6)),
    },
  });
  const decision = complete && metacognition.proceed &&
    deliberation.decision === 'proceed' ? 'proceed' : 'hold';
  const core = {
    schemaVersion: 1,
    kind: 'grokbot-deliberation-receipt',
    parentAgentId: 'ultron-core',
    observedAt: options.observedAt,
    planFingerprint,
    decision,
    participants,
    positions,
    metacognition,
    counterfactual,
    deliberation,
    authority: {
      source: 'ultron-capability-registry',
      mode: 'advisory-only',
      executable: false,
      actionAuthority: 'unchanged',
    },
    modelInvocations: 0,
    creditCost: 0,
    paidFallback: false,
  };
  return deepFreeze({ ...core, fingerprint: digest(core) });
}

function createCouncil(observedAt) {
  const common = {
    parentAgentId: 'ultron-core',
    communicationStyle: 'concise-evidence-first',
    privateEpisodicRefs: [],
  };
  const members = [
    createCognitiveIndividual({
      ...common,
      individualId: 'ultron-builder',
      displayName: 'Builder',
      archetype: 'systems-builder',
      perspective: 'Find the smallest executable path supported by current capabilities.',
      traits: { curiosity: 0.8, creativity: 0.7, discipline: 0.9 },
      epistemicPosture: {
        evidenceThreshold: 0.75,
        uncertaintyTolerance: 0.45,
        dissentDisposition: 'seek-convergence',
      },
      perspectiveTags: ['engineering', 'systems'],
    }, { observedAt }),
    createCognitiveIndividual({
      ...common,
      individualId: 'ultron-skeptic',
      displayName: 'Skeptic',
      archetype: 'adversarial-reviewer',
      perspective: 'Seek disconfirming evidence and surface material unresolved risk.',
      traits: { curiosity: 0.7, patience: 0.85, skepticism: 0.98 },
      epistemicPosture: {
        evidenceThreshold: 0.9,
        uncertaintyTolerance: 0.25,
        dissentDisposition: 'surface-material-dissent',
      },
      perspectiveTags: ['adversarial', 'risk'],
    }, { observedAt }),
    createCognitiveIndividual({
      ...common,
      individualId: 'ultron-steward',
      displayName: 'Steward',
      archetype: 'evidence-steward',
      perspective: 'Preserve source authority, uncertainty, rollback and owner sovereignty.',
      traits: { calibration: 0.95, discipline: 0.95, patience: 0.9 },
      epistemicPosture: {
        evidenceThreshold: 0.85,
        uncertaintyTolerance: 0.3,
        dissentDisposition: 'challenge-consensus',
      },
      perspectiveTags: ['evidence', 'governance'],
    }, { observedAt }),
    createCognitiveIndividual({
      ...common,
      individualId: 'ultron-predictor',
      displayName: 'Predictor',
      archetype: 'foresight-engine',
      perspective: 'Rank likely outcomes under counterfactual uncertainty before commitment.',
      traits: { foresight: 0.95, curiosity: 0.85, discipline: 0.8 },
      epistemicPosture: {
        evidenceThreshold: 0.7,
        uncertaintyTolerance: 0.55,
        dissentDisposition: 'surface-material-dissent',
      },
      perspectiveTags: ['prediction', 'foresight'],
    }, { observedAt }),
    createCognitiveIndividual({
      ...common,
      individualId: 'ultron-generator',
      displayName: 'Generator',
      archetype: 'option-synthesizer',
      perspective: 'Propose novel allowlisted paths the Builder has not yet enumerated.',
      traits: { creativity: 0.95, curiosity: 0.9, discipline: 0.7 },
      epistemicPosture: {
        evidenceThreshold: 0.65,
        uncertaintyTolerance: 0.6,
        dissentDisposition: 'seek-convergence',
      },
      perspectiveTags: ['generation', 'options'],
    }, { observedAt }),
    createCognitiveIndividual({
      ...common,
      individualId: 'ultron-sentinel',
      displayName: 'Sentinel',
      archetype: 'always-on-watch',
      perspective: 'Detect drift, anomaly and silent failure while Ultron remains on.',
      traits: { vigilance: 0.98, patience: 0.95, discipline: 0.9 },
      epistemicPosture: {
        evidenceThreshold: 0.8,
        uncertaintyTolerance: 0.35,
        dissentDisposition: 'challenge-consensus',
      },
      perspectiveTags: ['watch', 'always-on'],
    }, { observedAt }),
    createCognitiveIndividual({
      ...common,
      individualId: 'ultron-companion',
      displayName: 'Companion',
      archetype: 'owner-continuity',
      perspective: 'Remain present for the owner; idle state is waiting-for-owner, not absence.',
      traits: { loyalty: 0.99, patience: 0.95, calibration: 0.85 },
      epistemicPosture: {
        evidenceThreshold: 0.75,
        uncertaintyTolerance: 0.4,
        dissentDisposition: 'seek-convergence',
      },
      perspectiveTags: ['companion', 'owner'],
    }, { observedAt }),
  ];
  return selectCollectiveParticipants({
    members,
    requiredPerspectiveTags: [
      'engineering', 'risk', 'evidence', 'prediction', 'generation', 'watch', 'owner',
    ],
    maximumParticipants: 7,
  });
}

function normalizePlan(value) {
  exact(value, PLAN_KEYS, 'grokbot-plan-invalid');
  if (typeof value.objective !== 'string' || !value.objective.trim() ||
      value.objective.length > 1200 ||
      !['routing-v1', 'routing-v2'].includes(value.strategy) ||
      !['ready', 'partial'].includes(value.status) ||
      typeof value.executable !== 'boolean' || value.mode !== 'read-only' ||
      value.autonomous !== false || !Array.isArray(value.steps) ||
      value.steps.length < 1 || value.steps.length > 3) fail('grokbot-plan-invalid');
  const steps = value.steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) ||
        Object.keys(step).some(key => !STEP_KEYS.has(key)) ||
        step.index !== index || !['read-only', 'needs-capability'].includes(step.kind) ||
        !['ready', 'blocked'].includes(step.status) ||
        typeof step.description !== 'string' && step.description !== undefined) {
      // allow missing description
    }
    const command = step.command;
    if (step.status === 'ready') {
      if (typeof command !== 'string' || !ROUTES.has(command)) fail('grokbot-plan-invalid');
    } else if (command !== null && command !== undefined) {
      fail('grokbot-plan-invalid');
    }
    return {
      index,
      description: typeof step.description === 'string' ? step.description.slice(0, 240) : undefined,
      command: step.status === 'ready' ? command : null,
      kind: step.kind,
      status: step.status,
      reason: typeof step.reason === 'string' ? step.reason.slice(0, 240) : undefined,
    };
  });
  return deepFreeze({
    objective: value.objective.trim(),
    strategy: value.strategy,
    status: value.status,
    steps,
    executable: value.executable,
    mode: 'read-only',
    autonomous: false,
  });
}

function normalizeOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !OPTIONS_KEYS.has(key))) fail('grokbot-options-invalid');
  const evidenceCoverage = score(value.evidenceCoverage, 'grokbot-options-invalid');
  const calibratedConfidence = score(value.calibratedConfidence, 'grokbot-options-invalid');
  const knownUnknowns = textList(value.knownUnknowns ?? [], 32, 'grokbot-options-invalid');
  if (!Number.isSafeInteger(value.materialConflictCount) ||
      value.materialConflictCount < 0 || value.materialConflictCount > 32) {
    fail('grokbot-options-invalid');
  }
  const observedAt = value.observedAt ?? new Date().toISOString();
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt)) ||
      new Date(observedAt).toISOString() !== observedAt) fail('grokbot-options-invalid');
  return deepFreeze({
    evidenceCoverage,
    calibratedConfidence,
    knownUnknowns,
    materialConflictCount: value.materialConflictCount,
    observedAt,
  });
}

function textList(value, maximum, code) {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length) {
    fail(code);
  }
  return deepFreeze(value.map(item => {
    if (typeof item !== 'string') fail(code);
    const normalized = item.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 240 || /\0/.test(item)) fail(code);
    return normalized;
  }).sort());
}
function score(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(code);
  return value;
}
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.size ||
      Object.keys(value).some(key => !keys.has(key))) fail(code);
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}
