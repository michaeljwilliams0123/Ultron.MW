import { config } from 'hatchable';

const HEADER = 'x-ultron-origin-lock';
const enc = new TextEncoder();

async function getSecret() {
  try {
    const v = await config.get('ORIGIN_LOCK_SECRET');
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function readHeader(req, name) {
  const h = req?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  return h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()] ?? null;
}

function safeEqual(a, b) {
  const ab = enc.encode(String(a ?? ''));
  const bb = enc.encode(String(b ?? ''));
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function originLockPresent(req) {
  const secret = await getSecret();
  if (!secret) return false;
  return safeEqual(readHeader(req, HEADER), secret);
}

export async function requireOriginLock(req, res) {
  if (await originLockPresent(req)) return true;
  res.status(403).json({ error: 'origin-denied' });
  return false;
}