import { createHash } from 'node:crypto';

export function simulateCounterfactual({ observedState, stateUncertainty, action } = {}) {
  const state = normalizeState(observedState);
  const uncertainty = score(stateUncertainty, 'world-model-uncertainty-invalid');
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    fail('world-model-action-invalid');
  }
  const actionId = slug(action.actionId, 'world-model-action-invalid');
  const actionUncertainty = score(action.uncertainty, 'world-model-action-invalid');
  if (!action.effects || typeof action.effects !== 'object' || Array.isArray(action.effects)) {
    fail('world-model-action-invalid');
  }
  const predictedState = { ...state };
  for (const [key, delta] of Object.entries(action.effects)) {
    if (!(key in state)) fail('world-model-effect-unknown');
    if (typeof delta !== 'number' || !Number.isFinite(delta)) fail('world-model-action-invalid');
    predictedState[key] = Number((state[key] + delta).toFixed(12));
  }
  const predictedUncertainty = Number(Math.min(1, uncertainty + actionUncertainty).toFixed(12));
  const core = {
    schemaVersion: 1,
    kind: 'counterfactual-transition',
    actionId,
    observedState: state,
    predictedState,
    stateUncertainty: uncertainty,
    actionUncertainty,
    predictedUncertainty,
  };
  return deepFreeze({ ...core, fingerprint: digest(core) });
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('world-model-state-invalid');
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 1 || entries.length > 64) fail('world-model-state-invalid');
  const result = {};
  for (const [key, item] of entries) {
    stateKey(key);
    if (typeof item !== 'number' || !Number.isFinite(item)) fail('world-model-state-invalid');
    result[key] = item;
  }
  return deepFreeze(result);
}
function score(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(code);
  return value;
}
function stateKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) {
    fail('world-model-state-invalid');
  }
  return value;
}
function slug(value, code) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,95}$/.test(value)) fail(code);
  return value;
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
