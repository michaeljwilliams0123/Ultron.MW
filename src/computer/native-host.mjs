import { createHash, createPublicKey, verify } from 'node:crypto';
import { createFileComputerStore } from './file-store.mjs';

const ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const NONCE = /^[a-f0-9]{64}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_LIFETIME = 5 * 60 * 1000;
const MAX_RECORDS = 1000;
const ACTIONS = Object.freeze(['screen.observe', 'uia.discover', 'excel.read-cell', 'excel.write-cell']);
const hash = value => createHash('sha256').update(value).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function exact(value, keys) {
  if (!isObject(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key)))
    throw Error('native-host-invalid-fields');
}

function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw Error('native-host-invalid-id');
  return value;
}

function scope(values) {
  if (!Array.isArray(values) || values.length > 100)
    throw Error('native-host-invalid-scope');
  const result = values.map(id).sort();
  if (new Set(result).size !== result.length) throw Error('native-host-invalid-scope');
  return Object.freeze(result);
}

function publicKey(value) {
  if (typeof value !== 'string' || value.length > 1024 ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(value))
    throw Error('native-host-key-invalid');
  let key;
  try { key = createPublicKey(value); } catch { throw Error('native-host-key-invalid'); }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519')
    throw Error('native-host-key-invalid');
  return key;
}

function registration(input) {
  exact(input, ['hostId', 'proposalPublicKey', 'ownerPublicKey', 'targets', 'workbooks', 'maxPaidCents']);
  const proposalKey = publicKey(input.proposalPublicKey);
  const ownerKey = publicKey(input.ownerPublicKey);
  const fingerprint = key => hash(key.export({ type: 'spki', format: 'der' }));
  const record = Object.freeze({
    schema: 'ultron.native-host.registration.v1',
    hostId: id(input.hostId),
    proposalKeySha256: fingerprint(proposalKey),
    ownerKeySha256: fingerprint(ownerKey),
    targets: scope(input.targets),
    workbooks: scope(input.workbooks),
    maxPaidCents: input.maxPaidCents,
  });
  if (record.maxPaidCents !== 0 || record.proposalKeySha256 === record.ownerKeySha256)
    throw Error('native-host-registration-invalid');
  return { record, proposalKey, ownerKey };
}

function cell(value) {
  if (typeof value !== 'string' || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(value))
    throw Error('native-host-cell-invalid');
  const [, letters, row] = /^([A-Z]+)([0-9]+)$/.exec(value);
  const column = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (column > 16384 || Number(row) > 1048576) throw Error('native-host-cell-invalid');
  return value;
}

function actionParameters(action, params, reg) {
  if (!ACTIONS.includes(action)) throw Error('native-host-action-unsupported');
  if (action === 'screen.observe' || action === 'uia.discover') {
    exact(params, ['target']);
    const target = id(params.target);
    if (!reg.targets.includes(target)) throw Error('native-host-target-not-admitted');
    return { target };
  }
  exact(params, action === 'excel.read-cell'
    ? ['workbook', 'sheet', 'cell'] : ['workbook', 'sheet', 'cell', 'value']);
  const workbook = id(params.workbook);
  if (!reg.workbooks.includes(workbook)) throw Error('native-host-workbook-not-admitted');
  if (!Number.isInteger(params.sheet) || params.sheet < 1 || params.sheet > 256)
    throw Error('native-host-sheet-invalid');
  const result = { workbook, sheet: params.sheet, cell: cell(params.cell) };
  if (action === 'excel.write-cell') {
    if (typeof params.value !== 'string' || params.value.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(params.value) || /^\s*[=+\-@]/.test(params.value))
      throw Error('native-host-cell-value-invalid');
    result.value = params.value;
  }
  return result;
}

function deadline(expiresAt, now) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now || expiresAt - now > MAX_LIFETIME)
    throw Error('native-host-expired-or-invalid-expiry');
  return expiresAt;
}

function nonce(value) {
  if (typeof value !== 'string' || !NONCE.test(value)) throw Error('native-host-nonce-invalid');
  return value;
}

function proposal(input, reg, now) {
  exact(input, ['purpose', 'hostId', 'requestId', 'action', 'parameters', 'nonce', 'expiresAt']);
  if (input.purpose !== 'ultron.native.proposal.v1' || input.hostId !== reg.hostId)
    throw Error('native-host-purpose-or-host-invalid');
  return {
    purpose: input.purpose, hostId: reg.hostId, requestId: id(input.requestId),
    action: input.action, parameters: actionParameters(input.action, input.parameters, reg),
    nonce: nonce(input.nonce), expiresAt: deadline(input.expiresAt, now),
  };
}

function consent(input, reg, now) {
  exact(input, ['purpose', 'hostId', 'requestId', 'action', 'proposalDigest', 'decision', 'nonce', 'expiresAt']);
  if (input.purpose !== 'ultron.native.consent.v1' || input.hostId !== reg.hostId ||
      !ACTIONS.includes(input.action) || typeof input.proposalDigest !== 'string' ||
      !DIGEST.test(input.proposalDigest) ||
      !['approve', 'deny'].includes(input.decision))
    throw Error('native-host-consent-invalid');
  return {
    purpose: input.purpose, hostId: reg.hostId, requestId: id(input.requestId),
    action: input.action, proposalDigest: input.proposalDigest, decision: input.decision,
    nonce: nonce(input.nonce), expiresAt: deadline(input.expiresAt, now),
  };
}

function authenticated(payload, signature, key) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature))
    throw Error('native-host-signature-invalid');
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.length !== 64 || bytes.toString('base64url') !== signature ||
      !verify(null, Buffer.from(JSON.stringify(payload)), key, bytes))
    throw Error('native-host-signature-invalid');
}

/**
 * Returns the exact bytes that must be signed. Registration is configuration,
 * not a remote message, and must come from an independently trusted operator.
 */
export function canonicalNativeProposal(input, config, now = Date.now()) {
  return JSON.stringify(proposal(input, registration(config).record, now));
}

export function canonicalNativeConsent(input, config, now = Date.now()) {
  return JSON.stringify(consent(input, registration(config).record, now));
}

export function nativeHostCapabilities() {
  return Object.freeze({
    schema: 'ultron.native-host.capabilities.v1',
    runtime: 'unavailable', listener: false, maxPaidCents: 0,
    actions: Object.freeze(ACTIONS.map(action => Object.freeze({
      action, available: false, ownerConsent: 'one-time-expiring',
    }))),
  });
}

/**
 * Source-only local admission ledger. It cannot start a listener, load a native
 * adapter, capture pixels, or issue native actions. Never use as a remote API.
 */
export async function createNativeHost({ config, directory, clock = () => Date.now() } = {}) {
  const { record, proposalKey, ownerKey } = registration(config);
  if (typeof clock !== 'function') throw Error('native-host-clock-invalid');
  const store = createFileComputerStore(directory);
  const registrationDigest = hash(JSON.stringify(record));
  const hostId = record.hostId;

  function validateState(state) {
    if (!state || state.id !== hostId || state.schema !== 'ultron.native-host.ledger.v1' ||
        state.registrationDigest !== registrationDigest ||
        typeof state.revoked !== 'boolean' ||
        !Array.isArray(state.records) || state.records.length > MAX_RECORDS ||
        state.records.some(row => !isObject(row) || !ID.test(row.requestId || '') ||
          !ACTIONS.includes(row.action) || !DIGEST.test(row.proposalDigest || '') ||
          !NONCE.test(row.proposalNonce || '') ||
          !Number.isSafeInteger(row.proposalExpiresAt) ||
          !['proposed', 'approved', 'denied', 'dispatch-unavailable'].includes(row.status) ||
          (row.status !== 'proposed' &&
            (!NONCE.test(row.consentNonce || '') || !DIGEST.test(row.consentDigest || '') ||
             !Number.isSafeInteger(row.consentExpiresAt)))) ||
        new Set(state.records.map(row => row.requestId)).size !== state.records.length ||
        new Set(state.records.flatMap(row => [row.proposalNonce, ...(row.consentNonce ? [row.consentNonce] : [])])).size !==
          state.records.reduce((n, row) => n + 1 + (row.consentNonce ? 1 : 0), 0))
      throw Error('native-host-ledger-invalid-or-registration-conflict');
    return state;
  }

  async function read() {
    return validateState(await store.read(hostId));
  }

  async function persist(state) {
    try {
      await store.write(hostId, state);
      const observed = await read();
      if (JSON.stringify(observed) !== JSON.stringify(state))
        throw Error('native-host-readback-mismatch');
    } catch (error) {
      throw new Error('native-host-reconcile-required', { cause: error });
    }
  }

  await store.withLock(hostId, async () => {
    const existing = await store.read(hostId);
    if (existing) { validateState(existing); return; }
    await persist({ id: hostId, schema: 'ultron.native-host.ledger.v1',
      registrationDigest, revoked: false, records: [] });
  });

  const used = (state, value) => state.records.some(row =>
    row.proposalNonce === value || row.consentNonce === value);
  const live = state => {
    if (state.revoked) throw Error('native-host-revoked');
  };
  return Object.freeze({
    capabilities: nativeHostCapabilities,
    registration: record,
    async propose(input, signature) {
      const payload = proposal(input, record, clock());
      authenticated(payload, signature, proposalKey);
      const proposalDigest = hash(JSON.stringify(payload));
      return store.withLock(hostId, async () => {
        const state = await read();
        live(state);
        deadline(payload.expiresAt, clock());
        if (state.records.length >= MAX_RECORDS) throw Error('native-host-ledger-full');
        if (used(state, payload.nonce) || state.records.some(row => row.requestId === payload.requestId))
          throw Error('native-host-replay-or-request-conflict');
        state.records.push({ requestId: payload.requestId, action: payload.action,
          proposalDigest, proposalNonce: payload.nonce, proposalExpiresAt: payload.expiresAt,
          status: 'proposed' });
        await persist(state);
        return Object.freeze({ requestId: payload.requestId, proposalDigest, status: 'proposed' });
      });
    },
    async recordConsent(input, signature) {
      const payload = consent(input, record, clock());
      authenticated(payload, signature, ownerKey);
      return store.withLock(hostId, async () => {
        const state = await read();
        live(state);
        deadline(payload.expiresAt, clock());
        const row = state.records.find(item => item.requestId === payload.requestId);
        if (!row || row.status !== 'proposed' || used(state, payload.nonce) ||
            row.action !== payload.action || row.proposalDigest !== payload.proposalDigest)
          throw Error('native-host-consent-mismatch-or-replay');
        deadline(row.proposalExpiresAt, clock());
        row.consentNonce = payload.nonce;
        row.consentDigest = hash(JSON.stringify(payload));
        row.consentExpiresAt = payload.expiresAt;
        row.status = payload.decision === 'approve' ? 'approved' : 'denied';
        await persist(state);
        return Object.freeze({ requestId: row.requestId, status: row.status });
      });
    },
    async dispatch(requestId) {
      id(requestId);
      return store.withLock(hostId, async () => {
        const state = await read();
        live(state);
        const row = state.records.find(item => item.requestId === requestId);
        if (!row || row.status !== 'approved') throw Error('native-host-consent-required');
        deadline(row.proposalExpiresAt, clock());
        deadline(row.consentExpiresAt, clock());
        // Consume the approval even though this source slice has no native runtime.
        // No subsequent call may turn this attempt into a native side effect.
        row.status = 'dispatch-unavailable';
        await persist(state);
        return Object.freeze({ requestId, status: 'unavailable', reason: 'native-runtime-not-implemented' });
      });
    },
    async revoke() {
      return store.withLock(hostId, async () => {
        const state = await read();
        if (state.revoked) return Object.freeze({ status: 'revoked' });
        state.revoked = true;
        await persist(state);
        return Object.freeze({ status: 'revoked' });
      });
    },
    async readback(requestId) {
      id(requestId);
      return store.withLock(hostId, async () => {
        const state = await read();
        const row = state.records.find(item => item.requestId === requestId);
        return row ? Object.freeze({ ...row }) : null;
      });
    },
  });
}
