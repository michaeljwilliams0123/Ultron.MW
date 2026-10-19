import { createHash } from 'node:crypto';

export const COGNITIVE_INDIVIDUAL_SCHEMA_VERSION = 1;

const KEYS = new Set([
  'schemaVersion', 'kind', 'individualId', 'parentAgentId', 'displayName', 'archetype',
  'perspective', 'communicationStyle', 'traits', 'epistemicPosture', 'perspectiveTags',
  'privateEpisodicRefs', 'sharePolicy', 'authoritySource', 'observedAt', 'fingerprint',
]);
const POSTURE_KEYS = new Set([
  'evidenceThreshold', 'uncertaintyTolerance', 'dissentDisposition',
]);
const DISSENT = new Set([
  'surface-material-dissent', 'challenge-consensus', 'seek-convergence',
]);

export function createCognitiveIndividual(input, {
  observedAt = new Date().toISOString(),
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('cognitive-individual-invalid');
  }
  const core = normalizeCore({
    schemaVersion: COGNITIVE_INDIVIDUAL_SCHEMA_VERSION,
    kind: 'cognitive-individual',
    individualId: input.individualId,
    parentAgentId: input.parentAgentId,
    displayName: input.displayName,
    archetype: input.archetype,
    perspective: input.perspective,
    communicationStyle: input.communicationStyle,
    traits: input.traits,
    epistemicPosture: input.epistemicPosture,
    perspectiveTags: input.perspectiveTags,
    privateEpisodicRefs: input.privateEpisodicRefs ?? [],
    sharePolicy: 'explicit-promotion-only',
    authoritySource: 'ultron-capability-registry',
    observedAt,
  });
  return deepFreeze({ ...core, fingerprint: digest(core) });
}

export function validateCognitiveIndividual(value) {
  exact(value, KEYS, 'cognitive-individual-invalid');
  const core = normalizeCore(value);
  if (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) {
    fail('cognitive-individual-fingerprint-invalid');
  }
  const expected = digest(core);
  if (value.fingerprint !== expected) fail('cognitive-individual-fingerprint-invalid');
  return deepFreeze({ ...core, fingerprint: expected });
}

export function projectPublicCognitiveProfile(value) {
  const individual = validateCognitiveIndividual(value);
  return deepFreeze({
    schemaVersion: COGNITIVE_INDIVIDUAL_SCHEMA_VERSION,
    kind: 'public-cognitive-profile',
    individualId: individual.individualId,
    displayName: individual.displayName,
    archetype: individual.archetype,
    perspective: individual.perspective,
    communicationStyle: individual.communicationStyle,
    traits: individual.traits,
    epistemicPosture: individual.epistemicPosture,
    perspectiveTags: individual.perspectiveTags,
    privateMemoryCount: individual.privateEpisodicRefs.length,
    sharePolicy: individual.sharePolicy,
    authoritySource: individual.authoritySource,
    fingerprint: individual.fingerprint,
  });
}

function normalizeCore(value) {
  if (value.schemaVersion !== COGNITIVE_INDIVIDUAL_SCHEMA_VERSION ||
      value.kind !== 'cognitive-individual') fail('cognitive-individual-invalid');
  if (value.sharePolicy !== 'explicit-promotion-only' ||
      value.authoritySource !== 'ultron-capability-registry') {
    fail('cognitive-individual-invalid');
  }
  return {
    schemaVersion: COGNITIVE_INDIVIDUAL_SCHEMA_VERSION,
    kind: 'cognitive-individual',
    individualId: slug(value.individualId, 'cognitive-individual-invalid'),
    parentAgentId: slug(value.parentAgentId, 'cognitive-individual-invalid'),
    displayName: text(value.displayName, 120, 'cognitive-individual-invalid'),
    archetype: slug(value.archetype, 'cognitive-individual-invalid'),
    perspective: text(value.perspective, 1_000, 'cognitive-individual-invalid'),
    communicationStyle: slug(value.communicationStyle, 'cognitive-individual-invalid'),
    traits: normalizeTraits(value.traits),
    epistemicPosture: normalizePosture(value.epistemicPosture),
    perspectiveTags: slugList(value.perspectiveTags, 16, 'cognitive-individual-invalid'),
    privateEpisodicRefs: episodeRefs(value.privateEpisodicRefs),
    sharePolicy: 'explicit-promotion-only',
    authoritySource: 'ultron-capability-registry',
    observedAt: timestamp(value.observedAt, 'cognitive-individual-invalid'),
  };
}

function normalizeTraits(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('cognitive-individual-traits-invalid');
  }
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 16) fail('cognitive-individual-traits-invalid');
  const result = {};
  for (const [key, score] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    slug(key, 'cognitive-individual-traits-invalid');
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      fail('cognitive-individual-traits-invalid');
    }
    result[key] = score;
  }
  return deepFreeze(result);
}
function normalizePosture(value) {
  exact(value, POSTURE_KEYS, 'cognitive-individual-posture-invalid');
  if (typeof value.evidenceThreshold !== 'number' ||
      !Number.isFinite(value.evidenceThreshold) ||
      value.evidenceThreshold < 0 || value.evidenceThreshold > 1) {
    fail('cognitive-individual-posture-invalid');
  }
  if (typeof value.uncertaintyTolerance !== 'number' ||
      !Number.isFinite(value.uncertaintyTolerance) ||
      value.uncertaintyTolerance < 0 || value.uncertaintyTolerance > 1) {
    fail('cognitive-individual-posture-invalid');
  }
  if (!DISSENT.has(value.dissentDisposition)) fail('cognitive-individual-posture-invalid');
  return deepFreeze({ ...value });
}
function episodeRefs(value) {
  if (!Array.isArray(value) || value.length > 512 || new Set(value).size !== value.length) {
    fail('cognitive-individual-memory-invalid');
  }
  for (const item of value) {
    if (typeof item !== 'string' || !/^episode:sha256:[a-f0-9]{64}$/.test(item)) {
      fail('cognitive-individual-memory-invalid');
    }
  }
  return deepFreeze([...value].sort());
}
function slugList(value, maximum, code) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum ||
      new Set(value).size !== value.length) fail(code);
  return deepFreeze(value.map(item => slug(item, code)).sort());
}
function slug(value, code) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,95}$/.test(value)) fail(code);
  return value;
}
function text(value, maximum, code) {
  if (typeof value !== 'string') fail(code);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximum || /\0/.test(value)) fail(code);
  return normalized;
}
function timestamp(value, code) {
  const textValue = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (!Number.isFinite(Date.parse(textValue)) || new Date(textValue).toISOString() !== textValue) {
    fail(code);
  }
  return textValue;
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
