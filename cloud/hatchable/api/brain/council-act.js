import { db, config } from 'hatchable';
import { vaultFor, vaultKey } from 'lib/owner-vault.js';
import { verifyCouncilOidc } from 'lib/council-oidc.js';
import { validateCouncilPlan } from 'lib/council-plan.js';

export const access = 'public';
export const methods = ['POST'];

function response(res, status, value) {
  return res.status(status).json({ schema: 'ultron.council-act.v1', ...value });
}

export default async function handler(req, res) {
  let raw = null;
  try {
    raw = typeof req.rawBody === 'string' ? req.rawBody :
      req.rawBody instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(req.rawBody) : null;
  } catch {
    raw = null;
  }
  if (!raw || raw.length > 100000) return response(res, 400, { ok: false, error: 'request-invalid' });

  const authorization = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._-]{250,20000}$/.test(authorization)) {
    return response(res, 403, { ok: false, error: 'oidc-required' });
  }
  let identity;
  try {
    identity = await verifyCouncilOidc({ token: authorization.slice(7), rawBody: raw });
  } catch {
    return response(res, 403, { ok: false, error: 'oidc-invalid' });
  }

  let plan;
  try {
    plan = validateCouncilPlan(JSON.parse(raw));
  } catch {
    return response(res, 422, { ok: false, error: 'plan-invalid' });
  }
  let vault;
  try {
    vault = vaultFor(db, await vaultKey(config));
  } catch {
    return response(res, 503, { ok: false, error: 'vault-unavailable' });
  }

  const credentials = {};
  try {
    for (const member of plan.memberAssessments) {
      const role = member.identity.role;
      const app = await vault.get('app:' + role);
      if (!app?.id || !app?.pem) {
        return response(res, 409, { ok: false, error: 'council-app-not-registered', role });
      }
      credentials[role] = {
        appId: String(app.id),
        privateKey: app.pem,
        installationId: app.installationId || null
      };
    }
    res.setHeader?.('cache-control', 'no-store');
    return response(res, 200, {
      ok: true,
      actor: identity.actor,
      repository: 'michaeljwilliams0123/Ultron.MW',
      credentials
    });
  } catch (error) {
    return response(res, 503, { ok: false, error: String(error.message).slice(0, 160) });
  }
}
