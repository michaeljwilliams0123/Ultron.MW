import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, vaultKey, vaultFor } from '../cloud/hatchable/lib/owner-vault.js';

test('vault seals and opens, rejects tamper and wrong key', async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const blob = await seal({ a: 1 }, key);
  assert.deepEqual(await open(blob, key), { a: 1 });
  const wrongKey = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  await assert.rejects(open(blob, wrongKey));
  const b = Buffer.from(blob, 'base64'); b[b.length - 1] ^= 1;
  await assert.rejects(open(b.toString('base64'), key));
});

test('vaultKey requires a 32-byte base64 key', async () => {
  await assert.rejects(vaultKey({ get: async () => 'short' }));
  const key = await vaultKey({ get: async () => Buffer.alloc(32, 1).toString('base64') });
  assert.equal(key.algorithm.name, 'AES-GCM');
});

test('vaultFor round-trips through db.query', async () => {
  const rows = new Map();
  const key = await vaultKey({ get: async () => Buffer.alloc(32, 2).toString('base64') });
  const db = { query: async (sql, p) => {
    if (sql.startsWith('INSERT')) { rows.set(p[0], p[1]); return { rows: [] }; }
    if (sql.startsWith('SELECT blob')) return { rows: rows.has(p[0]) ? [{ blob: rows.get(p[0]) }] : [] };
    return { rows: [] };
  } };
  const v = vaultFor(db, key);
  await v.set('cred:x.com', { password: 'p' });
  assert.deepEqual(await v.get('cred:x.com'), { password: 'p' });
  assert.equal(await v.get('nope'), null);
});
