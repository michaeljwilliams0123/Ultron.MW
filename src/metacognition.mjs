import { createHash } from 'node:crypto';

const MAX_CALLER_UNKNOWNS = 32;
const MAX_COLLECTIVE_AGGREGATE_UNKNOWNS = 416;

export function assessMetacognition(input) {
  return assess(input, MAX_CALLER_UNKNOWNS);
}

export function assessCollectiveMetacognition(input) {
  return assess(input, MAX_COLLECTIVE_AGGREGATE_UNKNOWNS);
}

function assess(input, maximumKnownUnknowns) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('metacognition-invalid');
  const evidenceCoverage = score(input.evidenceCoverage, 'metacognition-invalid');
  const calibratedConfidence = score(input.calibratedConfidence, 'metacognition-invalid');
  const knownUnknowns = textList(
    input.knownUnknowns ?? [], maximumKnownUnknowns, 240, 'metacognition-invalid',
  );
  const materialConflictCount = integer(
    input.materialConflictCount, 0, 32, 'metacognition-invalid',
  );
  if (typeof input.reversible !== 'boolean') fail('metacognition-invalid');
  const calibrationGap = Number(Math.abs(calibratedConfidence - evidenceCoverage).toFixed(6));
  let action = 'proceed';
  if (materialConflictCount > 0 || knownUnknowns.length > 0) action = 'hold';
  else if (evidenceCoverage < 0.7 || calibrationGap > 0.25) action = 'seek-evidence';
  else if (!input.reversible && evidenceCoverage < 0.9) action = 'simulate';
  const core = {
    schemaVersion: 1,
    kind: 'metacognitive-assessment',
    evidenceCoverage,
    calibratedConfidence,
    calibrationGap,
    knownUnknowns,
    materialConflictCount,
    reversible: input.reversible,
    action,
    proceed: action === 'proceed',
  };
  return deepFreeze({ ...core, fingerprint: digest(core) });
}

function score(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(code);
  return value;
}
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}
function textList(value, maximum, maxLength, code) {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length) fail(code);
  return deepFreeze(value.map(item => text(item, maxLength, code)).sort());
}
function text(value, maximum, code) {
  if (typeof value !== 'string') fail(code);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maximum || /\0/.test(value)) fail(code);
  return normalized;
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
