import { requireOriginLock } from '../../lib/origin-lock.js';

export const access = 'public';
export const methods = ['GET'];

export default async function handler(req, res) {
  if (!(await requireOriginLock(req, res))) return;

  res.setHeader?.('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, lock: 'enforced' });
}