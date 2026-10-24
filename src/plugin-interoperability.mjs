// Descriptive catalogue only: an installed plugin is not an authenticated worker.
export const PLUGIN_INTEROPERABILITY_SCHEMA = 'ultron.plugin-interoperability.v1';
const define = (id, surface, pairs) => Object.freeze({
  id, surface, operations: Object.freeze(pairs.map(([name, effect]) =>
    Object.freeze({ name, effect }))),
});
export const PLUGIN_PROVIDERS = Object.freeze([
  define('github', 'connector', [
    ['repo.read', 'read'], ['pr.review', 'write'], ['pr.write', 'write'], ['pr.merge', 'write']]),
  define('desktop-commander', 'connector', [
    ['device.read', 'read'], ['files.read', 'read'], ['files.write', 'write'], ['process.run', 'write']]),
  define('descope', 'connector', [['identity.read', 'read'], ['identity.write', 'write']]),
  define('hugging-face', 'connector', [['model.search', 'read'], ['jobs.run', 'write']]),
  define('browser-use', 'connector', [['browser.read', 'read'], ['browser.act', 'write']]),
  define('compound-engineering', 'skill', [
    ['code.plan', 'read'], ['code.review', 'read'], ['code.implement', 'write']]),
  define('caveman', 'skill', [['code.review', 'read'], ['code.optimize', 'write']]),
]);
const providers = new Map(PLUGIN_PROVIDERS.map(item => [item.id, item]));
const ID = /^[a-z][a-z0-9_.-]{2,79}$/;
const EFFECTS = new Set(['read', 'write', 'destructive']);
const validCost = value => Number.isSafeInteger(value) && value >= 0;
export function createPluginInteroperability({
  broker, bindingIds = [], clock = () => Date.now(), maxHealthAgeMs = 300000,
} = {}) {
  if (!broker || typeof broker.status !== 'function' ||
      typeof broker.execute !== 'function' || typeof clock !== 'function' ||
      !Array.isArray(bindingIds) || bindingIds.some(id => !ID.test(id)) ||
      new Set(bindingIds).size !== bindingIds.length ||
      !Number.isSafeInteger(maxHealthAgeMs) || maxHealthAgeMs < 0 ||
      maxHealthAgeMs > 86400000)
    throw Error('Invalid plugin interoperability configuration');
  function snapshots() {
    return bindingIds.flatMap(id => {
      try {
        const result = broker.status(id);
        return result && typeof result.provider === 'string' ? [result] : [];
      } catch { return []; }
    });
  }
  function live(binding, now) {
    return binding.readiness === 'ready' &&
      typeof binding.checkedAt === 'string' &&
      Number.isFinite(Date.parse(binding.checkedAt)) &&
      now >= Date.parse(binding.checkedAt) &&
      now - Date.parse(binding.checkedAt) <= maxHealthAgeMs &&
      Date.parse(binding.expiresAt) > now;
  }
  function select({ provider, operation, effect, estimatedCostCents = 0 } = {}) {
    const spec = providers.get(provider);
    if (!spec) return { status: 'unsupported-provider' };
    if (!spec.operations.some(op => op.name === operation && op.effect === effect) ||
        !EFFECTS.has(effect) || !validCost(estimatedCostCents))
      return { status: 'unsupported-operation', provider };
    if (spec.surface === 'skill') return { status: 'skill-only', provider,
      reason: 'Skill instructions do not provide a separately authenticated execution adapter' };
    const now = clock();
    if (!Number.isFinite(now)) throw Error('Invalid clock');
    const matches = snapshots().filter(binding =>
      binding.provider === provider && live(binding, now) &&
      estimatedCostCents <= binding.maxCostCents &&
      Array.isArray(binding.operations) && binding.operations.some(op =>
        op.name === operation && op.effect === effect));
    matches.sort((a, b) => a.id.localeCompare(b.id));
    if (!matches.length) return { status: 'not-ready', provider, operation };
    return Object.freeze({
      status: 'ready', provider, operation, effect,
      bindingId: matches[0].id, estimatedCostCents,
      authority: 'broker-required',
    });
  }
  async function execute(request) {
    const route = select(request);
    if (route.status !== 'ready') return route;
    return broker.execute(route.bindingId, {
      operation: route.operation, input: request.input, expected: request.expected,
      idempotencyKey: request.idempotencyKey,
      estimatedCostCents: route.estimatedCostCents,
    });
  }
  function inventory() {
    const now = clock();
    return Object.freeze(PLUGIN_PROVIDERS.map(spec => Object.freeze({
      provider: spec.id, surface: spec.surface,
      readiness: spec.surface === 'skill' ? 'skill-only' :
        snapshots().some(binding => binding.provider === spec.id &&
          live(binding, now)) ? 'health-probed' : 'not-probed',
      operations: spec.operations.map(op => op.name),
    })));
  }
  return Object.freeze({ select, execute, inventory });
}
