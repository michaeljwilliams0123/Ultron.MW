/**
 * Explicit, encrypted browser-only continuity.
 * Password/key never leaves this module or enters localStorage.
 * Caveat: runtime third-party scripts and same-origin Pages can still access
 * plaintext while unlocked. This is encryption at rest, not code isolation.
 */
import { ACCEPTED_SEED, CANDIDATE, STRATEGIES, evaluateRouting } from './core/cycle.mjs';
export const VAULT_KEY = 'ultron.mw.browser.vault.v1';
const VERSION = 1;
const ITERATIONS = 210000;
const MAX_EXCHANGES = 32;
const MAX_PLANS = 16;
const MAX_STORAGE_CHARS = 360000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}
function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > MAX_STORAGE_CHARS) {
    throw new Error('Invalid encrypted vault encoding');
  }
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
function validateEnvelope(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_STORAGE_CHARS) throw new Error('Invalid encrypted vault size');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('Saved memory is corrupted'); }
  if (!value || value.version !== VERSION) throw new Error('Unsupported saved memory format');
  const salt = decodeBase64(value.salt);
  const iv = decodeBase64(value.iv);
  const data = decodeBase64(value.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 17) throw new Error('Invalid encrypted vault structure');
  return { salt, iv, data };
}
function validateRecord(item) {
  return item && typeof item.id === 'string' && item.id.length <= 100 &&
    typeof item.prompt === 'string' && item.prompt.length <= 1200 &&
    typeof item.answer === 'string' && item.answer.length <= 6000 &&
    typeof item.model === 'string' && item.model.length <= 160 &&
    typeof item.createdAt === 'string' && item.createdAt.length <= 48 &&
    (item.feedback === null || item.feedback === 'helpful' || item.feedback === 'not-helpful');
}
function validateContents(value) {
  if (!value || value.version !== VERSION || !Array.isArray(value.exchanges) ||
      value.exchanges.length > MAX_EXCHANGES || !value.exchanges.every(validateRecord) ||
      new Set(value.exchanges.map(entry => entry.id)).size !== value.exchanges.length) {
    throw new Error('Encrypted memory contains invalid records');
  }
  if (value.evolution !== undefined) {
    const evolution = value.evolution;
    if (!evolution || !STRATEGIES.includes(evolution.accepted) ||
        !Array.isArray(evolution.evaluations) || evolution.evaluations.length > 12 ||
        evolution.evaluations.some(e => !e || typeof e.benchmarkId !== 'string' ||
          !STRATEGIES.includes(e.baselineVersion) ||
          !STRATEGIES.includes(e.candidateVersion) ||
          typeof e.delta !== 'number' || !Number.isFinite(e.delta) ||
          typeof e.passed !== 'boolean')) {
      throw new Error('Encrypted memory contains invalid learning history');
    }
  }
  if (value.plans !== undefined) {
    if (!Array.isArray(value.plans) || value.plans.length > MAX_PLANS ||
        value.plans.some(p => !p || typeof p.id !== 'string' || p.id.length > 100 ||
          typeof p.objective !== 'string' || p.objective.length > 1200 ||
          !STRATEGIES.includes(p.strategy) || !Array.isArray(p.steps) ||
          p.steps.length < 1 || p.steps.length > 3 ||
          p.steps.some(step => !step || !['ready', 'blocked'].includes(step.status) ||
            (step.command !== null && typeof step.command !== 'string')))) {
      throw new Error('Encrypted memory contains invalid objective plans');
    }
  }
  return value;
}

export function createBrowserVault({
  storage = globalThis.localStorage,
  cryptoApi = globalThis.crypto,
  keyName = VAULT_KEY,
  now = () => new Date().toISOString(),
  uuid = () => cryptoApi.randomUUID(),
} = {}) {
  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem ||
      !cryptoApi?.subtle || !cryptoApi?.getRandomValues) {
    throw new Error('Local encrypted storage is not available in this browser');
  }
  let key = null;
  let salt = null;
  let state = null;
  let writes = Promise.resolve();

  function saved() { return storage.getItem(keyName) !== null; }
  function unlocked() { return !!key && !!state; }
  function lock() { key = null; salt = null; state = null; }
  async function derive(password, saltValue) {
    if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
      throw new Error('A passphrase of at least 10 characters is required');
    }
    const imported = await cryptoApi.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return cryptoApi.subtle.deriveKey({
      name: 'PBKDF2', salt: saltValue, iterations: ITERATIONS, hash: 'SHA-256',
    }, imported, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(next, encryptionKey, saltValue) {
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoApi.subtle.encrypt({
      name: 'AES-GCM', iv,
    }, encryptionKey, encoder.encode(JSON.stringify(next)));
    const envelope = JSON.stringify({
      version: VERSION, salt: encodeBase64(saltValue),
      iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    });
    if (envelope.length > MAX_STORAGE_CHARS) throw new Error('Saved memory exceeds browser size limit');
    return envelope;
  }
  async function open(password) {
    if (unlocked()) return snapshot();
    const existing = storage.getItem(keyName);
    if (existing !== null) {
      const envelope = validateEnvelope(existing);
      const derived = await derive(password, envelope.salt);
      let next;
      try {
        const decrypted = await cryptoApi.subtle.decrypt(
          { name: 'AES-GCM', iv: envelope.iv }, derived, envelope.data);
        next = validateContents(JSON.parse(decoder.decode(decrypted)));
      } catch {
        throw new Error('Could not unlock saved memory. Check the passphrase or saved data.');
      }
      salt = envelope.salt;
      key = derived;
      state = { ...next, plans: next.plans || [], evolution: next.evolution || { accepted: ACCEPTED_SEED, evaluations: [] } };
      return snapshot();
    }
    const nextSalt = cryptoApi.getRandomValues(new Uint8Array(16));
    const derived = await derive(password, nextSalt);
    const fresh = { version: VERSION, exchanges: [], plans: [], evolution: { accepted: ACCEPTED_SEED, evaluations: [] } };
    storage.setItem(keyName, await encrypt(fresh, derived, nextSalt));
    key = derived;
    salt = nextSalt;
    state = fresh;
    return snapshot();
  }
  function snapshot() {
    if (!unlocked()) return { unlocked: false, saved: saved(), exchanges: [], plans: [], statistics: statistics(), evolution: { accepted: ACCEPTED_SEED, evaluations: [] } };
    return {
      unlocked: true, saved: true,
      exchanges: state.exchanges.map(entry => ({ ...entry })),
      plans: structuredClone(state.plans || []),
      statistics: statistics(),
      evolution: structuredClone(state.evolution || { accepted: ACCEPTED_SEED, evaluations: [] }),
    };
  }
  function statistics() {
    const exchanges = state?.exchanges || [];
    const helpful = exchanges.filter(item => item.feedback === 'helpful').length;
    const notHelpful = exchanges.filter(item => item.feedback === 'not-helpful').length;
    return { total: exchanges.length, helpful, notHelpful, unrated: exchanges.length - helpful - notHelpful };
  }
  async function commit(modify) {
    if (!unlocked()) throw new Error('Unlock memory first');
    const operation = writes.then(async () => {
      const next = structuredClone(state);
      const result = modify(next);
      validateContents(next);
      const encrypted = await encrypt(next, key, salt);
      storage.setItem(keyName, encrypted);
      state = next;
      return result;
    });
    writes = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async function record({ prompt, answer, model }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1200 ||
        typeof answer !== 'string' || !answer.trim() || answer.length > 6000 ||
        typeof model !== 'string' || !model || model.length > 160) {
      throw new Error('Invalid browser conversation record');
    }
    const entry = Object.freeze({
      id: uuid(), prompt: prompt.trim(), answer: answer.trim(), model,
      feedback: null, createdAt: now(),
    });
    return commit(next => {
      next.exchanges.push(entry);
      next.exchanges = next.exchanges.slice(-MAX_EXCHANGES);
      return { ...entry };
    });
  }
  async function rate(id, feedback) {
    if (!['helpful', 'not-helpful'].includes(feedback)) throw new Error('Invalid feedback');
    return commit(next => {
      const item = next.exchanges.find(entry => entry.id === id);
      if (!item) throw new Error('Saved response not found');
      item.feedback = feedback;
      return { id: item.id, feedback };
    });
  }
  function context(limit = 3) {
    if (!unlocked()) return [];
    const chosen = state.exchanges.slice(-Math.max(0, Math.min(limit, 3)));
    const messages = [];
    for (const item of chosen) {
      messages.push({ role: 'user', content: item.prompt.slice(0, 750) });
      messages.push({ role: 'assistant', content: item.answer.slice(0, 1100) });
      if (item.feedback === 'not-helpful') {
        messages.push({ role: 'user', content: 'Feedback: that previous response was not helpful. Avoid repeating its shortcomings.' });
      }
    }
    return messages;
  }
  function encryptedBackup() {
    const data = storage.getItem(keyName);
    if (!data) throw new Error('No saved memory to export');
    validateEnvelope(data);
    return data;
  }
  async function importBackup(raw, password, { replace = false } = {}) {
    await writes;
    const envelope = validateEnvelope(raw);
    const derived = await derive(password, envelope.salt);
    let next;
    try {
      const decoded = await cryptoApi.subtle.decrypt(
        { name: 'AES-GCM', iv: envelope.iv }, derived, envelope.data);
      next = validateContents(JSON.parse(decoder.decode(decoded)));
    } catch {
      throw new Error('Could not decrypt imported backup. Check the passphrase or file.');
    }
    if (saved() && !replace) throw new Error('Existing memory requires explicit replacement approval');
    // The original encrypted state remains unchanged if the storage write fails.
    storage.setItem(keyName, raw);
    key = derived;
    salt = envelope.salt;
    state = { ...next, plans: next.plans || [], evolution: next.evolution || { accepted: ACCEPTED_SEED, evaluations: [] } };
    return snapshot();
  }
  async function savePlan(plan) {
    if (!plan || typeof plan.objective !== 'string' || !plan.objective.trim() ||
        plan.objective.length > 1200 || !STRATEGIES.includes(plan.strategy) ||
        !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 3) {
      throw new Error('Invalid objective plan');
    }
    return commit(next => {
      next.plans ||= [];
      const entry = {
        ...structuredClone(plan), id: uuid(), createdAt: now(),
        status: 'draft', autonomous: false,
      };
      next.plans.push(entry);
      next.plans = next.plans.slice(-MAX_PLANS);
      return structuredClone(entry);
    });
  }
  function evolution() {
    if (!unlocked()) return { accepted: ACCEPTED_SEED, evaluations: [] };
    return structuredClone(state.evolution || { accepted: ACCEPTED_SEED, evaluations: [] });
  }
  async function evaluateAndAdopt() {
    return commit(next => {
      next.evolution ||= { accepted: ACCEPTED_SEED, evaluations: [] };
      if (next.evolution.accepted === CANDIDATE) {
        return { status: 'already-adopted', accepted: CANDIDATE };
      }
      const report = evaluateRouting({ accepted: next.evolution.accepted });
      next.evolution.evaluations.push({
        benchmarkId: report.benchmarkId,
        baselineVersion: report.baselineVersion, candidateVersion: report.candidateVersion,
        delta: report.delta, passed: report.passed, regressions: report.regressions,
        criticalRegressions: report.criticalRegressions, total: report.total,
        baselineAccuracy: report.baselineAccuracy, candidateAccuracy: report.candidateAccuracy,
        evaluatedAt: report.evaluatedAt,
      });
      next.evolution.evaluations = next.evolution.evaluations.slice(-12);
      if (report.passed) next.evolution.accepted = report.candidateVersion;
      return { ...report, status: report.passed ? 'adopted' : 'rejected' };
    });
  }
  async function rollbackRouting(reason) {
    if (typeof reason !== 'string' || !reason.trim()) throw new Error('Reason required for rollback');
    return commit(next => {
      next.evolution ||= { accepted: ACCEPTED_SEED, evaluations: [] };
      if (next.evolution.accepted === ACCEPTED_SEED) throw new Error('No routing change to roll back');
      const before = next.evolution.accepted;
      next.evolution.accepted = ACCEPTED_SEED;
      next.evolution.evaluations.push({
        benchmarkId: 'owner-rollback', baselineVersion: before, candidateVersion: ACCEPTED_SEED,
        delta: 0, passed: false, evaluatedAt: now(),
      });
      next.evolution.evaluations = next.evolution.evaluations.slice(-12);
      return { status: 'rolled-back', accepted: ACCEPTED_SEED };
    });
  }
  function clear() {
    storage.removeItem(keyName);
    lock();
  }
  return { saved, unlocked, open, lock, snapshot, statistics, record, rate, context, encryptedBackup, importBackup, savePlan, evolution, evaluateAndAdopt, rollbackRouting, clear };
}
