// Descriptive catalogue only: an installed plugin is not an authenticated worker.
export const PLUGIN_INTEROPERABILITY_SCHEMA = 'ultron.plugin-interoperability.v1';
const define = (id, surface, pairs) => Object.freeze({
  id, surface, operations: Object.freeze(pairs.map(([name, effect]) =>
    Object.freeze({ name, effect }))),
});
export const PLUGIN_PROVIDERS = Object.freeze([
  define('github', 'connector', [
    ['repo.read', 'read'], ['pr.review', 'write'], ['pr.write', 'write'], ['pr.merge', 'write']]),
  define('mahoraga', 'connector', [
    ['mahoraga.issue.create', 'write'], ['mahoraga.workflow.dispatch', 'write']]),
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
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;
const EFFECTS = new Set(['read', 'write', 'destructive']);
const validCost = value => Number.isSafeInteger(value) && value >= 0;

export function createAdapterRegistry({ initial = [], maxPaidCents = 0 } = {}) {
  if (!Array.isArray(initial) || !validCost(maxPaidCents)) {
    throw Error('Invalid adapter registry configuration');
  }
  const entries = new Map();
  function normalizeEntry(spec) {
    if (!spec || typeof spec.id !== 'string' || !ID.test(spec.id) ||
        typeof spec.version !== 'string' || !VERSION.test(spec.version) ||
        !Array.isArray(spec.operations) || spec.operations.length === 0) {
      throw Error('Invalid adapter registration');
    }
    const base = providers.get(spec.id);
    if (base?.surface === 'skill' || spec.surface === 'skill') {
      throw Error('Skill surfaces cannot register as execution adapters');
    }
    const maxCostCents = spec.maxCostCents ?? 0;
    if (!validCost(maxCostCents) || maxCostCents > maxPaidCents) {
      throw Error('Adapter cost ceiling exceeds zero-spend policy');
    }
    const ops = spec.operations.map(op => {
      if (!op || typeof op.name !== 'string' || !op.name || !EFFECTS.has(op.effect)) {
        throw Error('Invalid adapter operation');
      }
      return Object.freeze({ name: op.name, effect: op.effect });
    });
    return Object.freeze({
      id: spec.id,
      version: spec.version,
      surface: 'connector',
      enabled: spec.enabled !== false,
      maxCostCents,
      operations: Object.freeze(ops),
    });
  }
  function register(spec) {
    const entry = normalizeEntry(spec);
    const existing = entries.get(entry.id) || { activeIndex: -1, history: [] };
    if (existing.history.some(item => item.version === entry.version)) {
      throw Error('Duplicate adapter version');
    }
    const history = [...existing.history, entry];
    entries.set(entry.id, { activeIndex: history.length - 1, history });
    return entry;
  }
  function setEnabled(id, enabled) {
    const record = entries.get(id);
    if (!record) throw Error('Unknown adapter');
    const current = record.history[record.activeIndex];
    const updated = Object.freeze({ ...current, enabled: Boolean(enabled) });
    record.history[record.activeIndex] = updated;
    return updated;
  }
  function disable(id) { return setEnabled(id, false); }
  function enable(id) { return setEnabled(id, true); }
  function rollback(id, targetVersion) {
    const record = entries.get(id);
    if (!record || record.history.length < 2) {
      throw Error('No prior adapter version available for rollback');
    }
    let idx = record.activeIndex - 1;
    if (targetVersion !== undefined) {
      idx = record.history.findIndex(item => item.version === targetVersion);
      if (idx === -1 || idx === record.activeIndex) {
        throw Error('Invalid rollback target version');
      }
    } else if (idx < 0) {
      throw Error('No prior adapter version available for rollback');
    }
    record.activeIndex = idx;
    return record.history[idx];
  }
  function get(id) {
    const record = entries.get(id);
    return record ? record.history[record.activeIndex] : null;
  }
  function list() {
    return Object.freeze([...entries.values()].map(r => r.history[r.activeIndex]));
  }
  for (const spec of initial) register(spec);
  return Object.freeze({ register, disable, enable, rollback, get, list });
}

export function createPluginInteroperability({
  broker, bindingIds = [], registry = null, clock = () => Date.now(), maxHealthAgeMs = 300000,
} = {}) {
  if (!broker || typeof broker.status !== 'function' ||
      typeof broker.execute !== 'function' || typeof clock !== 'function' ||
      !Array.isArray(bindingIds) || bindingIds.some(id => !ID.test(id)) ||
      new Set(bindingIds).size !== bindingIds.length ||
      !Number.isSafeInteger(maxHealthAgeMs) || maxHealthAgeMs < 0 ||
      maxHealthAgeMs > 86400000)
    throw Error('Invalid plugin interoperability configuration');
  function resolveSpec(provider) {
    const reg = registry?.get(provider);
    if (reg) return reg;
    return providers.get(provider) || null;
  }
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
    const spec = resolveSpec(provider);
    if (!spec) return { status: 'unsupported-provider' };
    if (spec.enabled === false) {
      return { status: 'adapter-disabled', provider, version: spec.version };
    }
    if (!spec.operations.some(op => op.name === operation && op.effect === effect) ||
        !EFFECTS.has(effect) || !validCost(estimatedCostCents) ||
        (typeof spec.maxCostCents === 'number' && estimatedCostCents > spec.maxCostCents))
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
      version: spec.version || null,
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
    const merged = new Map(PLUGIN_PROVIDERS.map(spec => [spec.id, spec]));
    if (registry) {
      for (const item of registry.list()) merged.set(item.id, item);
    }
    return Object.freeze([...merged.values()].map(spec => Object.freeze({
      provider: spec.id, surface: spec.surface,
      version: spec.version || null,
      enabled: spec.enabled !== false,
      readiness: spec.surface === 'skill' ? 'skill-only' :
        spec.enabled === false ? 'disabled' :
        snapshots().some(binding => binding.provider === spec.id &&
          live(binding, now)) ? 'health-probed' : 'not-probed',
      operations: spec.operations.map(op => op.name),
    })));
  }
  return Object.freeze({ select, execute, inventory });
}
