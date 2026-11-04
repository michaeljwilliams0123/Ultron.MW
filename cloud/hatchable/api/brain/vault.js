import { db, config } from 'hatchable';
import { vaultKey, vaultFor } from 'lib/owner-vault.js';

export const access = 'admin';
export const methods = ['GET', 'POST', 'DELETE'];

export default async function handler(req, res) {
  const vault = vaultFor(db, await vaultKey(config));
  if (req.method === 'GET') {
    const keys = await vault.list('cred:');
    return res.json({ sites: keys.map(key => key.slice(5)) });
  }

  const site = String(req.body?.site || '').toLowerCase();
  if (!/^[a-z0-9.-]{3,253}$/.test(site)) return res.status(400).json({ error: 'site-invalid' });
  if (req.method === 'DELETE') {
    await vault.del('cred:' + site);
    return res.json({ ok: true });
  }

  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'credential-invalid' });
  }
  await vault.set('cred:' + site, { username, password });
  return res.json({ ok: true, site });
}
