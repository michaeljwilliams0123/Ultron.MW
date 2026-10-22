/**
 * Owner-session admission for a browser execution host.
 *
 * This module NEVER authenticates an owner by itself. The host must inject
 * verifyOwner from its existing authenticated channel and a separate operator
 * approval callback. A local TTY is operator presence, not remote OAuth proof.
 */
const ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const INTERACTIVE = new Set(['click', 'type', 'keypress']);

export function createComputerSessionAuthority({
  sessionId, expiresAt, allowedOrigins, verifyOwner, requestApproval,
  maxApprovals = 20, clock = () => Date.now(),
} = {}) {
  const deadline = Date.parse(expiresAt);
  const now = clock();
  if (!ID.test(sessionId || '') || !Number.isFinite(deadline) ||
      !Number.isFinite(now) || deadline <= now || deadline - now > 60 * 60 * 1000 ||
      !Array.isArray(allowedOrigins) || allowedOrigins.length === 0 ||
      allowedOrigins.some(origin => {
        try {
          const u = new URL(origin);
          return u.origin !== origin || u.username || u.password ||
            !['https:', 'http:'].includes(u.protocol) ||
            u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
        } catch { return true; }
      }) ||
      typeof verifyOwner !== 'function' || typeof requestApproval !== 'function' ||
      !Number.isInteger(maxApprovals) || maxApprovals < 1 || maxApprovals > 30)
    throw Error('Invalid or unauthenticated computer session configuration');

  const admitted = new Set(allowedOrigins);
  let revoked = false;
  let approved = 0;
  const live = () => !revoked && Number.isFinite(clock()) &&
    clock() < deadline && approved < maxApprovals;

  return Object.freeze({
    get status() { return revoked ? 'revoked' : clock() >= deadline ? 'expired' :
      approved >= maxApprovals ? 'exhausted' : 'active'; },
    revoke() { revoked = true; },
    async authorize(context) {
      if (!live() || !context || !INTERACTIVE.has(context.action) ||
          !admitted.has(context.currentOrigin)) return false;
      // The actual identity/session validity is checked by a separate trusted
      // host. The model, page contents and source plan never choose this result.
      if (await verifyOwner({ sessionId, action: context.action,
        currentOrigin: context.currentOrigin }) !== true || !live()) return false;
      if (await requestApproval({ ...context, sessionId, expiresAt }) !== true ||
          !live()) return false;
      approved++;
      return true;
    },
  });
}
