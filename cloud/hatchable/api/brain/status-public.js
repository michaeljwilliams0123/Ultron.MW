// Public, strictly read-only operational view for the one GitHub Pages UI.
// No task text, event payload, identities, tokens, credentials, or write actions.
import { db } from 'hatchable';
export const access = 'public';
export const methods = ['GET'];
const PAGES_ORIGIN = 'https://michaeljwilliams0123.github.io';
export default async function (req, res) {
  if (req.headers?.origin === PAGES_ORIGIN)
    res.setHeader('Access-Control-Allow-Origin', PAGES_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { rows } = await db.query(
      'SELECT c.paused, (SELECT MAX(created_at) FROM brain_events) AS last_event_at ' +
      'FROM brain_runtime_control c WHERE c.id = 1 LIMIT 1'
    );
    if (!rows?.length) throw Error('runtime-control-unavailable');
    return res.json({
      schema: 'ultron.cloud-status.v1',
      ok: true,
      status: rows[0].paused ? 'paused' : 'active',
      observedAt: new Date().toISOString(),
      lastEventAt: rows[0].last_event_at ? new Date(rows[0].last_event_at).toISOString() : null,
      scheduler: 'hourly-configured',
      ownerOperations: 'protected'
    });
  } catch {
    return res.status(503).json({
      schema: 'ultron.cloud-status.v1',
      ok: false,
      status: 'unavailable'
    });
  }
}
