import { config } from 'hatchable';
import { getWorkersAiReadiness, runWorkersAi } from 'lib/cloudflare-workers-ai.js';

export const access = 'admin';
export const methods = ['GET', 'POST'];

const OWNER = 'michaeljwilliams0123';
const SCHEMA = 'ultron.cloudflare-workers-ai.v1';

export default async function (req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.member?.handle !== OWNER) {
    return res.status(403).json({
      schema: SCHEMA,
      error: 'owner-identity-required',
    });
  }

  if (req.method === 'GET') {
    const readiness = await getWorkersAiReadiness({ config });
    return res.status(200).json({
      schema: SCHEMA,
      ...readiness,
    });
  }

  if (req.method === 'POST') {
    const { mode, text, labels } = req.body && typeof req.body === 'object' ? req.body : {};
    const outcome = await runWorkersAi({ config, mode, text, labels });
    return res.status(outcome.status).json({
      schema: SCHEMA,
      ...outcome,
    });
  }

  return res.status(405).json({
    schema: SCHEMA,
    error: 'method-not-allowed',
  });
}