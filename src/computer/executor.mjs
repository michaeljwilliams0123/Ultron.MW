import { createHash } from 'node:crypto';

export const COMPUTER_ACTIONS = Object.freeze(['navigate','click','type','keypress','scroll','observe','extract','wait']);
const ACTIVE = new Set(['click','type','keypress']);
const ACTIONS = new Set(COMPUTER_ACTIONS);
const VALID_ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bounded = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const matchesExpectation = (observation, expectation) =>
  (!expectation?.urlIncludes || String(observation?.url || '').includes(expectation.urlIncludes)) &&
  (!expectation?.textIncludes || String(observation?.text || '').includes(expectation.textIncludes));
const safeUrl = (url, origins) => {
  let parsed;
  try { parsed = new URL(url); } catch { throw Error('Invalid browser URL'); }
  if (!['https:','http:'].includes(parsed.protocol) ||
    (parsed.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) ||
    parsed.username || parsed.password || !origins.includes(parsed.origin))
    throw Error('Browser origin not admitted');
  return parsed;
};

export function normalizeComputerPlan(raw, { allowedOrigins = [] } = {}) {
  if (!raw || !VALID_ID.test(raw.id || '') || !Array.isArray(raw.steps) ||
      raw.steps.length < 1 || raw.steps.length > 30 ||
      !Array.isArray(allowedOrigins) || !allowedOrigins.length ||
      allowedOrigins.some(x => { try { const u = new URL(x); return u.origin !== x || u.username || u.password || !['https:','http:'].includes(u.protocol) || u.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname); } catch { return true; } }))
    throw Error('Invalid computer plan or missing explicit origin allowlist');
  const steps = raw.steps.map((s, index) => {
    if (!s || s.id !== undefined && !VALID_ID.test(s.id) || !ACTIONS.has(s.action))
      throw Error('Unknown or unbounded computer action');
    const keys = { navigate: ['id','action','url','expect'], click: ['id','action','selector','expect'],
      type: ['id','action','selector','value','expect'], keypress: ['id','action','selector','key','expect'],
      scroll: ['id','action','pixels','expect'], observe: ['id','action','expect'],
      extract: ['id','action','selector','expect'], wait: ['id','action','selector','timeoutMs','expect'] };
    if (Object.keys(s).some(k => !keys[s.action].includes(k)))
      throw Error('Unexpected computer action property');
    if (ACTIVE.has(s.action) &&
        (!s.expect || typeof s.expect !== 'object' ||
         Object.keys(s.expect).length === 0))
      throw Error('Interactive computer action requires a verifiable postcondition');
    const id = s.id || 'step-' + (index + 1);
    const entry = { id, action: s.action };
    if (s.action === 'navigate') {
      if (!bounded(s.url, 2048)) throw Error('Navigation URL required');
      safeUrl(s.url, allowedOrigins);
      entry.url = s.url;
    } else if (['click','type','keypress','extract','wait'].includes(s.action)) {
      if (!bounded(s.selector, 240) || /[\u0000-\u001f]/.test(s.selector))
        throw Error('Bounded selector required');
      entry.selector = s.selector;
    }
    if (s.action === 'type') {
      if (typeof s.value !== 'string' || s.value.length > 2048)
        throw Error('Type value invalid');
      entry.value = s.value;
    }
    if (s.action === 'keypress') {
      if (!bounded(s.key, 48) || !/^[a-zA-Z0-9+_-]+$/.test(s.key))
        throw Error('Key sequence invalid');
      entry.key = s.key;
    }
    if (s.action === 'scroll') {
      if (!Number.isInteger(s.pixels) || Math.abs(s.pixels) > 3000)
        throw Error('Scroll magnitude invalid');
      entry.pixels = s.pixels;
    }
    if (s.action === 'wait') {
      if (!Number.isInteger(s.timeoutMs) || s.timeoutMs < 1 || s.timeoutMs > 10000)
        throw Error('Wait timeout invalid');
      entry.timeoutMs = s.timeoutMs;
    }
    if (s.expect !== undefined) {
      if (!s.expect || typeof s.expect !== 'object' ||
        !Object.keys(s.expect).every(k => ['urlIncludes','textIncludes'].includes(k)) ||
        !Object.values(s.expect).every(v => bounded(v, 120)))
        throw Error('Invalid verification expectation');
      entry.expect = { ...s.expect };
    }
    return Object.freeze(entry);
  });
  if (new Set(steps.map(s => s.id)).size !== steps.length)
    throw Error('Duplicate step IDs');
  return Object.freeze({ id: raw.id, steps, allowedOrigins: Object.freeze([...allowedOrigins]) });
}

/**
 * A minimal, evidence-grounded browser worker. It never grants itself
 * approval. An external owner-authenticated callback must authorize all
 * mouse/keyboard interactions, including apparently harmless clicks.
 * State is persisted BEFORE dispatch; an ambiguous write never replays.
 */
export function createComputerExecutor({ driver, store, authorize = async () => false,
  canContinue = async () => true, allowedOrigins,
  clock = () => new Date().toISOString() } = {}) {
  if (!driver || typeof driver.observe !== 'function' || !store ||
      typeof store.read !== 'function' || typeof store.write !== 'function' ||
      typeof authorize !== 'function' || typeof canContinue !== 'function')
    throw Error('Executor requires driver, durable store and authority callback');

  async function run(raw) {
    const plan = normalizeComputerPlan(raw, { allowedOrigins });
    if (typeof store.withLock === 'function')
      return store.withLock(plan.id, () => runLocked(plan));
    return runLocked(plan);
  }

  async function runLocked(plan) {
    const fingerprint = digest(plan);
    let state = await store.read(plan.id);
    if (state && state.fingerprint !== fingerprint)
      throw Error('Plan ID reused with different instructions');
    state ||= { id: plan.id, fingerprint, status: 'running', completed: [],
      receipts: [], pending: null, createdAt: clock() };
    if (state.pending || state.status === 'reconcile-required')
      return { status: 'reconcile-required', id: plan.id, pending: state.pending,
        receipts: [...state.receipts] };
    if (!Array.isArray(state.completed) || !Array.isArray(state.receipts) ||
        !['running','approval-required','completed'].includes(state.status) ||
        state.completed.some(id => !plan.steps.some(s => s.id === id)) ||
        new Set(state.completed).size !== state.completed.length)
      throw Error('Checkpoint inconsistent; reconciliation required');
    if (state.status === 'completed')
      return { status: 'completed', id: plan.id, receipts: [...state.receipts], resumed: true };

    async function sessionGate(step) {
      if (await canContinue({ planId: plan.id, stepId: step.id,
        action: step.action }) === true) return null;
      state.status = 'approval-required';
      await store.write(plan.id, state);
      return { status: 'approval-required', id: plan.id, stepId: step.id,
        reason: 'Owner session expired or revoked', receipts: [...state.receipts] };
    }

    async function preflightAction(step) {
      if (!ACTIVE.has(step.action) || typeof driver.preflight !== 'function')
        return true;
      try { return await driver.preflight(step) === true; }
      catch { return false; }
    }

    async function actionNotReady(step, reason) {
      state.status = 'approval-required';
      await store.write(plan.id, state);
      return {
        status: 'action-not-ready', id: plan.id, stepId: step.id,
        reason, receipts: [...state.receipts],
      };
    }

    for (const step of plan.steps) {
      if (state.completed.includes(step.id)) continue;
      const blocked = await sessionGate(step);
      if (blocked) return blocked;
      const before = await driver.observe();
      const blockedAfterObservation = await sessionGate(step);
      if (blockedAfterObservation) return blockedAfterObservation;
      if (before.requiresOwnerTakeover && step.action !== 'observe') {
        state.status = 'approval-required';
        await store.write(plan.id, state);
        return { status: 'owner-takeover-required', id: plan.id,
          stepId: step.id, reason: 'Credential or MFA form needs owner takeover',
          receipts: [...state.receipts] };
      }
      // A newly launched isolated browser starts at about:blank.
      // Only first-step navigation may begin from that browser-native state.
      if (!(step.action === 'navigate' && before.url === 'about:blank'))
        safeUrl(before.url, allowedOrigins);
      if (ACTIVE.has(step.action) && step.action !== 'type' &&
          matchesExpectation(before, step.expect))
        throw Error('Interactive postcondition already satisfied before action');
      // Validate actionability before asking the owner for permission or
      // recording an uncertain pending action. Trial clicks never activate UI.
      if (!await preflightAction(step))
        return actionNotReady(step,
          'Target not actionable; no interaction dispatched');
      if (ACTIVE.has(step.action) && await authorize({
        planId: plan.id, planFingerprint: fingerprint, action: step.action,
        stepId: step.id, currentOrigin: new URL(before.url).origin,
        selector: step.selector, valueLength: step.action === 'type' ? step.value.length : undefined,
        key: step.action === 'keypress' ? step.key : undefined,
        expectedState: step.expect
      }) !== true) {
        state.status = 'approval-required';
        await store.write(plan.id, state);
        return { status: 'approval-required', id: plan.id, stepId: step.id,
          receipts: [...state.receipts] };
      }
      // Approval can take long enough for a script or navigation to replace
      // the target. Revalidate after consent and before the durable pending
      // checkpoint so a stale approval never dispatches a different element.
      if (!await preflightAction(step))
        return actionNotReady(step,
          'Target changed or became unavailable after owner approval');
      const blockedBeforeCheckpoint = await sessionGate(step);
      if (blockedBeforeCheckpoint) return blockedBeforeCheckpoint;
      state.status = 'running';
      state.pending = step.id;
      await store.write(plan.id, state);
      let failurePhase = 'before-dispatch';
      let after = null;
      try {
        // If the session ends during checkpoint persistence, preserve the
        // pending action for explicit reconciliation rather than dispatching.
        if (await canContinue({ planId: plan.id, stepId: step.id,
          action: step.action }) !== true)
          throw Error('Owner session ended before action dispatch');
        failurePhase = 'action-dispatch';
        const result = await driver.perform(step);
        failurePhase = 'post-action-observation';
        after = await driver.observe();
        failurePhase = 'post-action-origin-check';
        safeUrl(after.url, allowedOrigins);
        // An expectation matching the PRE-action screen is not evidence
        // of successful execution. Input fills may instead be confirmed by
        // the Playwright driver reading back the specific field value.
        failurePhase = 'postcondition-verification';
        const changed = before.url !== after.url || before.title !== after.title ||
          before.text !== after.text;
        if (step.action === 'type' && result?.fieldValueVerified !== true)
          throw Error('Typed field value was not independently verified');
        if (ACTIVE.has(step.action) && step.action !== 'type' && !changed)
          throw Error('Interactive action has no independently observable effect');
        if (!matchesExpectation(after, step.expect))
          throw Error('Expected post-action state not observed');
        const receipt = {
          stepId: step.id, action: step.action, status: 'verified', observedAt: clock(),
          origin: new URL(after.url).origin, observationDigest: digest({
            url: after.url, text: String(after.text || '').slice(0, 10000),
            title: after.title || '', screenshotDigest: after.screenshotDigest || null,
            accessibilityDigest: after.accessibilityDigest || null,
          }),
          resultDigest: digest(result ?? null),
          visualDigest: after.screenshotDigest || null,
          accessibilityDigest: after.accessibilityDigest || null,
        };
        // Do not mutate the in-memory last durable checkpoint until the
        // complete next checkpoint has been committed. Failed post-action
        // persistence MUST leave the last durable pending step in place.
        const next = { ...state, completed: [...state.completed, step.id],
          receipts: [...state.receipts, receipt], pending: null };
        failurePhase = 'receipt-persistence';
        await store.write(plan.id, next);
        state = next;
      } catch (error) {
        // An action may already have fired even if Playwright times out.
        // Capture a SECOND, strictly read-only observation when possible,
        // without re-running the click or persisting DOM text/screenshot data.
        if (!after) {
          try { after = await driver.observe(); }
          catch { /* Browser may have closed or navigated. */ }
        }
        let observedPath = null;
        let observedOrigin = null;
        if (after?.url) {
          try {
            const parsed = new URL(after.url);
            if (['https:', 'http:'].includes(parsed.protocol)) {
              observedOrigin = parsed.origin;
              observedPath = parsed.pathname.slice(0, 160);
            }
          } catch { /* Unknown browser location remains unverified. */ }
        }
        const failureKind = error?.name === 'TimeoutError' ?
          'browser-timeout' : error?.name === 'TargetClosedError' ?
            'browser-closed' : 'execution-or-verification-error';
        const diagnostics = {
          failurePhase, failureKind, observedOrigin, observedPath,
          observedVisualDigest: typeof after?.screenshotDigest === 'string' ?
            after.screenshotDigest : null,
        };
        // Keep the uncertain write pending, regardless of the observed path.
        // An observed URL alone never certifies a completed interaction.
        state = { ...state, pending: step.id, status: 'reconcile-required',
          errorCode: 'outcome-unverified', ...diagnostics };
        await store.write(plan.id, state);
        return { status: 'reconcile-required', id: plan.id, pending: step.id,
          reason: 'Outcome unverified; inspect the application before retrying',
          ...diagnostics, receipts: [...state.receipts] };
      }
    }
    state.status = 'completed';
    await store.write(plan.id, state);
    return { status: 'completed', id: plan.id, receipts: [...state.receipts] };
  }
  return Object.freeze({ run });
}

export function createMemoryComputerStore() {
  const map = new Map(), locks = new Set();
  return {
    async read(id) { return map.has(id) ? structuredClone(map.get(id)) : null; },
    async write(id, value) { map.set(id, structuredClone(value)); },
    async withLock(id, action) {
      if (locks.has(id)) throw Error('Computer objective already running; reconcile before retry');
      locks.add(id);
      try { return await action(); } finally { locks.delete(id); }
    },
  };
}
