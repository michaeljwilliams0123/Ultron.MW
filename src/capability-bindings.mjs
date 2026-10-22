import { createHash } from 'node:crypto';

const ID = /^[a-z][a-z0-9_.-]{2,79}$/;
const NAME = /^[a-z][a-z0-9_.:-]{1,79}$/;
const ACTOR = /^[a-z0-9][a-z0-9:._-]{2,127}$/i;
const IDEMPOTENCY = /^[a-z0-9][a-z0-9_.:-]{7,127}$/i;
const EFFECTS = new Set(['read', 'write', 'destructive']);
const AUTH = new Set(['oauth2', 'app-token', 'workflow-identity', 'local-owner']);
const RUNTIMES = new Set(['github-actions', 'cloud-api', 'local-node', 'hosted-worker']);
const BINDING_KEYS = new Set(['id', 'provider', 'runtime', 'actorRef', 'authMethod',
  'origins', 'operations', 'expiresAt', 'maxCostCents', 'credentialRef']);
const OPERATION_KEYS = new Set(['name', 'effect', 'scope']);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function serializable(value, max = 20_000) {
  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined && encoded.length <= max;
  } catch { return false; }
}

function canonicalOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password &&
      (url.protocol === 'https:' || url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

/** A binding is capability metadata, never a credential or proof of readiness. */
export function validateCapabilityBinding(input) {
  if (!input || typeof input !== 'object' ||
      Object.keys(input).some(key => !BINDING_KEYS.has(key)) ||
      !ID.test(input.id || '') || !NAME.test(input.provider || '') ||
      !RUNTIMES.has(input.runtime) || !ACTOR.test(input.actorRef || '') ||
      !AUTH.has(input.authMethod) ||
      !Array.isArray(input.origins) || !input.origins.length ||
      input.origins.some(origin => !canonicalOrigin(origin)) ||
      new Set(input.origins).size !== input.origins.length ||
      !Array.isArray(input.operations) || !input.operations.length ||
      input.operations.length > 40 ||
      input.operations.some(operation => !operation || typeof operation !== 'object' ||
        Object.keys(operation).some(key => !OPERATION_KEYS.has(key)) ||
        !NAME.test(operation.name || '') || !EFFECTS.has(operation.effect) ||
        !NAME.test(operation.scope || '')) ||
      new Set(input.operations.map(operation => operation.name)).size !== input.operations.length ||
      !Number.isSafeInteger(input.maxCostCents) || input.maxCostCents < 0 ||
      input.maxCostCents > 100_000 ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      input.credentialRef !== null &&
        !(typeof input.credentialRef === 'string' &&
          /^env:ULTRON_[A-Z0-9_]{3,60}$/.test(input.credentialRef)))
    throw Error('Invalid capability binding manifest');
  return Object.freeze({
    schema: 'ultron.binding.v1', id: input.id, provider: input.provider,
    runtime: input.runtime, actorRef: input.actorRef, authMethod: input.authMethod,
    origins: Object.freeze([...input.origins]),
    operations: Object.freeze(input.operations.map(operation => Object.freeze({...operation}))),
    expiresAt: new Date(input.expiresAt).toISOString(),
    maxCostCents: input.maxCostCents, credentialRef: input.credentialRef,
  });
}

function publicStatus(record) {
  return Object.freeze({
    schema: record.binding.schema, id: record.binding.id,
    provider: record.binding.provider, runtime: record.binding.runtime,
    actorRef: record.binding.actorRef, authMethod: record.binding.authMethod,
    origins: record.binding.origins, operations: record.binding.operations,
    expiresAt: record.binding.expiresAt, maxCostCents: record.binding.maxCostCents,
    credentialConfigured: record.binding.credentialRef !== null,
    readiness: record.readiness, healthDigest: record.healthDigest || null,
    checkedAt: record.checkedAt || null,
  });
}

function adapterContract(adapter) {
  if (!adapter || ['health', 'execute', 'observe', 'unbind']
    .some(method => typeof adapter[method] !== 'function'))
    throw Error('Capability adapter contract incomplete');
}

/**
 * One narrow broker for independently authenticated providers. It retains
 * metadata and digests only; credentials and provider response bodies stay in
 * the adapter/runtime that owns them.
 */
export function createCapabilityBroker({ authorize = async () => false,
  clock = () => new Date().toISOString() } = {}) {
  if (typeof authorize !== 'function' || typeof clock !== 'function')
    throw Error('Capability broker requires authority and clock functions');
  const bindings = new Map();
  const attempts = new Map();

  function recordFor(id, { allowExpired = false } = {}) {
    const record = bindings.get(id);
    if (!record) throw Error('Unknown capability binding');
    if (Date.parse(record.binding.expiresAt) <= Date.parse(clock())) {
      record.readiness = 'expired';
      if (!allowExpired) throw Error('Capability binding expired');
    }
    return record;
  }

  function bind(raw, adapter) {
    const binding = validateCapabilityBinding(raw);
    adapterContract(adapter);
    const fingerprint = digest(binding);
    const prior = bindings.get(binding.id);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw Error('Binding ID reused with different authority');
      return { ...publicStatus(prior), resumed: true };
    }
    const record = { binding, adapter, fingerprint, readiness: 'not-probed' };
    bindings.set(binding.id, record);
    return publicStatus(record);
  }

  function status(id) { return publicStatus(recordFor(id, { allowExpired: true })); }

  async function health(id) {
    const record = recordFor(id);
    const result = await record.adapter.health({ binding: record.binding });
    if (!result || !['ready', 'partial', 'revoked'].includes(result.status) ||
        !ACTOR.test(result.actorRef || '') || !Array.isArray(result.grantedScopes) ||
        result.grantedScopes.some(scope => !NAME.test(scope)) ||
        !serializable(result, 4_000))
      throw Error('Invalid provider health evidence');
    const required = new Set(record.binding.operations.map(operation => operation.scope));
    const granted = new Set(result.grantedScopes);
    record.readiness = result.status === 'ready' &&
      result.actorRef === record.binding.actorRef &&
      [...required].every(scope => granted.has(scope)) ? 'ready' : result.status === 'revoked'
        ? 'revoked' : 'partial';
    record.checkedAt = clock();
    record.healthDigest = digest({ status: result.status, actorRef: result.actorRef,
      grantedScopes: [...granted].sort() });
    return publicStatus(record);
  }

  async function observe(id, query = {}) {
    const record = recordFor(id);
    if (record.readiness !== 'ready') throw Error('Capability binding not ready');
    if (!serializable(query, 4_000)) throw Error('Observation query invalid');
    const observation = await record.adapter.observe({ binding: record.binding, query });
    if (!observation || typeof observation.verified !== 'boolean' ||
        !serializable(observation, 20_000))
      throw Error('Invalid provider observation');
    return Object.freeze({ bindingId: id, verified: observation.verified,
      observedAt: clock(), observationDigest: digest(observation) });
  }

  async function execute(id, request) {
    const record = recordFor(id);
    if (record.readiness !== 'ready') throw Error('Capability binding not ready');
    if (!request || typeof request !== 'object' ||
        !NAME.test(request.operation || '') || !IDEMPOTENCY.test(request.idempotencyKey || '') ||
        !Number.isSafeInteger(request.estimatedCostCents) ||
        request.estimatedCostCents < 0 ||
        request.estimatedCostCents > record.binding.maxCostCents ||
        !serializable(request.input) || !serializable(request.expected, 4_000))
      throw Error('Invalid capability request');
    const operation = record.binding.operations.find(item => item.name === request.operation);
    if (!operation) throw Error('Operation not admitted by binding');
    const attemptId = `${id}:${request.idempotencyKey}`;
    const fingerprint = digest({ operation: request.operation, input: request.input,
      expected: request.expected, estimatedCostCents: request.estimatedCostCents });
    const prior = attempts.get(attemptId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw Error('Idempotency key reused with different request');
      return Object.freeze({ ...prior.receipt, resumed: true });
    }
    if (operation.effect !== 'read' && await authorize({
      bindingId: id, provider: record.binding.provider,
      actorRef: record.binding.actorRef, operation: operation.name,
      effect: operation.effect, scope: operation.scope,
      idempotencyKey: request.idempotencyKey,
      estimatedCostCents: request.estimatedCostCents,
      maxCostCents: record.binding.maxCostCents,
    }) !== true)
      return Object.freeze({ status: 'approval-required', bindingId: id,
        operation: operation.name });

    const pending = { fingerprint, receipt: { status: 'reconcile-required',
      bindingId: id, provider: record.binding.provider, operation: operation.name,
      effect: operation.effect, idempotencyKey: request.idempotencyKey,
      reason: 'Provider outcome requires independent reconciliation' } };
    attempts.set(attemptId, pending);
    try {
      const result = await record.adapter.execute({ binding: record.binding,
        operation: operation.name, input: request.input,
        idempotencyKey: request.idempotencyKey,
        estimatedCostCents: request.estimatedCostCents });
      const observation = await record.adapter.observe({ binding: record.binding,
        query: { operation: operation.name, expected: request.expected,
          resultDigest: digest(result ?? null) } });
      if (!observation || observation.verified !== true ||
          !serializable(observation, 20_000)) throw Error('Outcome not verified');
      pending.receipt = Object.freeze({ status: 'completed', bindingId: id,
        provider: record.binding.provider, actorRef: record.binding.actorRef,
        operation: operation.name, effect: operation.effect,
        idempotencyKey: request.idempotencyKey, observedAt: clock(),
        costCents: request.estimatedCostCents,
        resultDigest: digest(result ?? null), observationDigest: digest(observation) });
      return pending.receipt;
    } catch {
      return Object.freeze({ ...pending.receipt });
    }
  }

  async function unbind(id) {
    const record = recordFor(id, { allowExpired: true });
    if (await authorize({ bindingId: id, provider: record.binding.provider,
      actorRef: record.binding.actorRef, operation: 'unbind', effect: 'destructive' }) !== true)
      return Object.freeze({ status: 'approval-required', bindingId: id });
    const result = await record.adapter.unbind({ binding: record.binding });
    if (result?.revoked !== true) throw Error('Provider did not confirm revocation');
    bindings.delete(id);
    return Object.freeze({ status: 'unbound', bindingId: id, revokedAt: clock() });
  }

  return Object.freeze({ bind, status, health, observe, execute, unbind });
}
