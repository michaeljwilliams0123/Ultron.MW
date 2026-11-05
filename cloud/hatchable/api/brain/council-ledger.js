import { db } from 'hatchable';
import { verifyCouncilOidc, verifyCouncilWorkerOidc } from 'lib/council-oidc.js';
import { reserveExecution, transitionExecution, readExecution, listOpenExecutions } from 'lib/council-ledger.js';

export const access = 'public';
export const methods = ['POST'];

function response(res, status, value) {
  return res.status(status).json({ schema: 'ultron.council-ledger.v1', ...value });
}

export default async function handler(req, res) {
  let raw = null;
  try {
    raw = typeof req.rawBody === 'string' ? req.rawBody :
      req.rawBody instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(req.rawBody) : null;
  } catch {
    raw = null;
  }
  if (!raw || raw.length > 60000) return response(res, 400, { ok: false, error: 'request-invalid' });

  const header = req.headers?.authorization || req.headers?.Authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return response(res, 403, { ok: false, error: 'oidc-required' });
  }
  let identity;
  try {
    identity = await verifyCouncilOidc({ token: header.slice(7), rawBody: raw });
  } catch {
    try {
      identity = await verifyCouncilWorkerOidc({ token: header.slice(7), rawBody: raw });
    } catch {
      return response(res, 403, { ok: false, error: 'oidc-invalid' });
    }
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return response(res, 422, { ok: false, error: 'json-invalid' });
  }
  try {
    if (body.op === 'reserve') {
      const out = await reserveExecution(db, body);
      return response(res, 200, { ok: true, actor: identity.actor, ...out });
    }
    if (body.op === 'transition') {
      const out = await transitionExecution(db, body);
      return response(res, out.ok ? 200 : 409, { actor: identity.actor, ...out });
    }
    if (body.op === 'read') {
      const record = await readExecution(db, body.key);
      return response(res, record ? 200 : 404, { ok: Boolean(record), record });
    }
    if (body.op === 'open') {
      return response(res, 200, { ok: true, open: await listOpenExecutions(db, body.limit) });
    }
    return response(res, 422, { ok: false, error: 'op-invalid' });
  } catch (error) {
    const message = String(error?.message || 'ledger-error').slice(0, 120);
    return response(res, /invalid/.test(message) ? 422 : 503, { ok: false, error: message });
  }
}
