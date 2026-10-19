import { createHash } from 'node:crypto';
import {
  validateCognitiveIndividual,
  projectPublicCognitiveProfile,
} from './cognitive-individual.mjs';

const POSITION_KEYS = new Set([
  'individualId', 'conclusion', 'confidence', 'evidenceRefs',
  'assumptions', 'unknowns', 'dissentTags',
]);

export function selectCollectiveParticipants({
  members = [], requiredPerspectiveTags = [], maximumParticipants = 3,
} = {}) {
  if (!Array.isArray(members) || !Array.isArray(requiredPerspectiveTags) ||
      !Number.isSafeInteger(maximumParticipants) || maximumParticipants < 1 ||
      maximumParticipants > 12) fail('collective-selection-invalid');
  const candidates = members.map(validateCognitiveIndividual);
  const required = slugList(requiredPerspectiveTags, 32, 'collective-selection-invalid');
  const uncovered = new Set(required);
  const selected = [];
  while (uncovered.size > 0 && selected.length < maximumParticipants) {
    const ranked = candidates
      .filter(member => !selected.some(item => item.individualId === member.individualId))
      .map(member => ({
        member,
        gain: member.perspectiveTags.filter(tag => uncovered.has(tag)).length,
      }))
      .filter(item => item.gain > 0)
      .sort((a, b) => b.gain - a.gain ||
        a.member.individualId.localeCompare(b.member.individualId));
    if (ranked.length === 0) break;
    const winner = ranked[0].member;
    selected.push(winner);
    for (const tag of winner.perspectiveTags) uncovered.delete(tag);
  }
  if (uncovered.size > 0) fail('collective-perspective-coverage-insufficient');
  return deepFreeze(selected.map(projectPublicCognitiveProfile)
    .sort((a, b) => a.individualId.localeCompare(b.individualId)));
}

export function createCollectivePosition(input) {
  exact(input, POSITION_KEYS, 'collective-position-invalid');
  const core = normalizePosition(input);
  return deepFreeze({
    schemaVersion: 1,
    kind: 'collective-position',
    ...core,
    fingerprint: digest(core),
  });
}

export function synthesizeCollectiveDeliberation({ positions = [] } = {}) {
  if (!Array.isArray(positions) || positions.length < 1 || positions.length > 12) {
    fail('collective-deliberation-invalid');
  }
  const normalized = positions.map(item => {
    if (item?.schemaVersion === 1 && item?.kind === 'collective-position') {
      const { schemaVersion, kind, fingerprint, ...raw } = item;
      const core = normalizePosition(raw);
      if (fingerprint !== digest(core)) fail('collective-position-fingerprint-invalid');
      return { schemaVersion, kind, ...core, fingerprint };
    }
    return createCollectivePosition(item);
  });
  const materialDissent = normalized
    .filter(item => item.dissentTags.length > 0 && item.confidence >= 0.8)
    .sort((a, b) => b.confidence - a.confidence ||
      a.individualId.localeCompare(b.individualId));
  const evidenceRefs = [...new Set(normalized.flatMap(item => item.evidenceRefs))].sort();
  const unknowns = [...new Set(normalized.flatMap(item => item.unknowns))].sort();
  const ranked = [...normalized].sort((a, b) => b.confidence - a.confidence ||
    b.evidenceRefs.length - a.evidenceRefs.length ||
    a.individualId.localeCompare(b.individualId));
  const decision = materialDissent.length > 0 ? 'hold' : ranked[0].conclusion;
  const core = {
    schemaVersion: 1,
    kind: 'collective-deliberation',
    decision,
    selectedIndividualId: ranked[0].individualId,
    evidenceRefs,
    unknowns,
    materialDissent: materialDissent.map(item => ({
      individualId: item.individualId,
      conclusion: item.conclusion,
      confidence: item.confidence,
      dissentTags: item.dissentTags,
    })),
    positionFingerprints: normalized.map(item => item.fingerprint).sort(),
  };
  return deepFreeze({ ...core, fingerprint: digest(core) });
}

function normalizePosition(value) {
  return {
    individualId: slug(value.individualId, 'collective-position-invalid'),
    conclusion: token(value.conclusion, 96, 'collective-position-invalid'),
    confidence: score(value.confidence, 'collective-position-invalid'),
    evidenceRefs: textList(value.evidenceRefs, 32, 160, 'collective-position-invalid'),
    assumptions: textList(value.assumptions, 32, 240, 'collective-position-invalid'),
    unknowns: textList(value.unknowns, 32, 240, 'collective-position-invalid'),
    dissentTags: slugList(value.dissentTags, 16, 'collective-position-invalid'),
  };
}
function score(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(code);
  return value;
}
function slugList(value, maximum, code) {
  if (!Array.isArray(value) || value.length > maximum ||
      new Set(value).size !== value.length) fail(code);
  return deepFreeze(value.map(item => slug(item, code)).sort());
}
function textList(value, maximum, maxLength, code) {
  if (!Array.isArray(value) || value.length > maximum ||
      new Set(value).size !== value.length) fail(code);
  return deepFreeze(value.map(item => text(item, maxLength, code)).sort());
}
function slug(value, code) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,95}$/.test(value)) fail(code);
  return value;
}
function token(value, maximum, code) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum ||
      !/^[a-z0-9][a-z0-9.-]*$/.test(value)) fail(code);
  return value;
}
function text(value, maximum, code) {
  if (typeof value !== 'string') fail(code);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximum || /\0/.test(value)) fail(code);
  return normalized;
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
