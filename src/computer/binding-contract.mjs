import { COMPUTER_ACTIONS, createComputerExecutor } from './executor.mjs';

const ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const actions = new Set(COMPUTER_ACTIONS);
const props = new Set(['id', 'kind', 'runtime', 'allowedOrigins',
  'operations', 'enabled', 'maxSteps', 'credentialRef']);

/**
 * Adapter-level connection metadata. The shared user-command catalogue in
 * docs/core/capabilities.mjs remains authoritative for current commands.
 * A binding is NOT a bearer token or proof that an account is connected.
 */
export function validateComputerBinding(input) {
  if (!input || typeof input !== 'object' ||
      Object.keys(input).some(key => !props.has(key)) ||
      !ID.test(input.id || '') ||
      input.kind !== 'computer.browser' ||
      !['local-node', 'hosted-browser'].includes(input.runtime) ||
      typeof input.enabled !== 'boolean' ||
      !Array.isArray(input.allowedOrigins) || !input.allowedOrigins.length ||
      !Array.isArray(input.operations) || !input.operations.length ||
      input.operations.some(op => !actions.has(op)) ||
      new Set(input.operations).size !== input.operations.length ||
      !Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 30 ||
      input.credentialRef !== undefined && input.credentialRef !== null &&
        !(typeof input.credentialRef === 'string' && /^env:[A-Z0-9_]{5,80}$/.test(input.credentialRef)))
    throw Error('Invalid or untrusted computer binding manifest');
  for (const item of input.allowedOrigins) {
    let url;
    try { url = new URL(item); } catch { throw Error('Invalid binding origin'); }
    if (url.origin !== item || url.username || url.password ||
        !['https:', 'http:'].includes(url.protocol) ||
        url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname))
      throw Error('Invalid binding origin');
  }
  return Object.freeze({
    schema: 'ultron.binding.v1', id: input.id, kind: input.kind,
    runtime: input.runtime, enabled: input.enabled,
    allowedOrigins: Object.freeze([...input.allowedOrigins]),
    operations: Object.freeze([...input.operations]),
    maxSteps: input.maxSteps, credentialRef: input.credentialRef || null,
    readiness: 'not-probed',
  });
}

export function createBoundComputerExecutor({ binding, driver, store,
  authorize, clock } = {}) {
  const manifest = validateComputerBinding(binding);
  if (!manifest.enabled) throw Error('Computer binding disabled');
  const admitted = new Set(manifest.operations);
  const executor = createComputerExecutor({
    driver, store, clock, allowedOrigins: manifest.allowedOrigins,
    authorize: async context => admitted.has(context.action) &&
      typeof authorize === 'function' && await authorize(context) === true,
  });
  return {
    manifest,
    async run(plan) {
      if (!plan?.steps || plan.steps.length > manifest.maxSteps ||
          plan.steps.some(s => !admitted.has(s.action)))
        throw Error('Plan exceeds binding capabilities');
      return executor.run(plan);
    },
  };
}
