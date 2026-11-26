import { db } from 'hatchable';
import {
  CANONICAL_OWNER,
  enrollStandingPolicy,
  prepareStandingPolicy,
  readActiveStandingPolicy,
  revokeStandingPolicy,
} from 'lib/standing-release-policy.js';

export const access = 'admin';
export const methods = ['GET', 'POST'];

const ORIGIN = 'https://ultron-mw-cloud.hatchable.site';

export default async function (req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.member?.handle !== CANONICAL_OWNER) {
    return res.status(403).json({ ok: false, reason: 'owner-identity-required' });
  }
  if (req.headers?.origin && req.headers.origin !== ORIGIN) {
    return res.status(403).json({ ok: false, reason: 'origin-denied' });
  }
  if (req.method === 'GET') {
    const policy = await readActiveStandingPolicy({ db });
    return res.json({ schema: 'ultron.release-standing-policy-view.v1', ok: true, policy });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, reason: 'method-not-allowed' });
  }
  const body = req.body || {};
  if (body.mode === 'prepare') {
    const result = await prepareStandingPolicy({db,credentialId:body.credentialId,
      maxReleases:body.maxReleases,days:body.days,enabled:body.enabled});
    return res.status(result.ok ? 200 : 422).json(result);
  }
  if (body.mode === 'enroll') {
    const result = await enrollStandingPolicy({
      db,
      policy: body.policy,
      passkeyProof: body.passkeyProof,
      enabled: body.enabled,
    });
    return res.status(result.ok ? 200 : 422).json(result);
  }
  if (body.mode === 'revoke') {
    const result = await revokeStandingPolicy({
      db,
      policyId: body.policyId,
      reason: body.reason || 'owner-revoked',
      bumpStop: body.bumpStop !== false,
    });
    return res.status(result.ok ? 200 : 404).json(result);
  }
  return res.status(422).json({ ok: false, reason: 'command-invalid' });
}
