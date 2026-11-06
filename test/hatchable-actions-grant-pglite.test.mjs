import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { signApprovedRequest, encryptGrant } from '../src/autonomy/independent-signer.mjs';
import { decryptVerifiedGrant } from '../src/autonomy/grant-recipient.mjs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {}
const skip = PGlite ? false : '@electric-sql/pglite not installed';
const file = name => readFile(new URL(`../cloud/hatchable/migrations/${name}`, import.meta.url), 'utf8');

test('signed Actions grant commits once and reconciles a lost response in PostgreSQL', { skip }, async () => {
  globalThis.crypto ??= webcrypto;
  const source = await readFile(new URL('../cloud/hatchable/lib/mcp-signed-mutation.js', import.meta.url), 'utf8');
  const transformed = source
    .replace("'lib/security-adjudicator.js'", JSON.stringify(new URL('../cloud/hatchable/lib/security-adjudicator.js', import.meta.url).href))
    .replace("'lib/owner-live-events.js'", JSON.stringify(new URL('../cloud/hatchable/lib/owner-live-events.js', import.meta.url).href));
  const { prepareMutation, executeMutation, reconcileMutation } = await import(
    'data:text/javascript;base64,' + Buffer.from(transformed).toString('base64'));
  const db = new PGlite();
  try {
    for (const name of ['0001_tasks.sql', '0002_events.sql', '0003_native_commands.sql',
      '0008_admin_grants.sql', '0010_runtime_stop.sql', '0016_owner_autonomy_profile.sql',
      '0029_mcp_mutation_ledger.sql']) await db.exec(await file(name));
    await db.exec(`UPDATE brain_owner_autonomy_profile
      SET version=2,allowed_operations=allowed_operations || '["mcp.queue.submit"]'::jsonb WHERE id=1`);
    const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const recipient = await webcrypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const signerPublicJwk = await webcrypto.subtle.exportKey('jwk', signing.publicKey);
    const mutation = { operation: 'mcp.queue.submit', key: 'pglite-test-01', objective: 'repo.inspect',
      expectedProfileVersion: 2, expectedStopVersion: 1 };
    const { grantRequest } = await prepareMutation(mutation);
    const envelope = await signApprovedRequest({ request: grantRequest, mutation,
      privateJwk: await webcrypto.subtle.exportKey('jwk', signing.privateKey) });
    const encrypted = await encryptGrant(envelope, await webcrypto.subtle.exportKey('jwk', recipient.publicKey));
    const recovered = await decryptVerifiedGrant({ encrypted, signerPublicJwk, mutation,
      recipientPrivateJwk: await webcrypto.subtle.exportKey('jwk', recipient.privateKey) });
    let writes = 0;
    const transport = { async query(sql, params) {
      const result = await db.query(sql, params);
      if (sql.includes('INSERT INTO brain_mcp_mutations')) {
        writes++;
        if (writes === 1) throw new Error('simulated lost acknowledgement');
      }
      return result;
    } };
    const config = { get: async () => JSON.stringify(signerPublicJwk) };
    const first = await executeMutation({ db: transport, config, request: mutation, envelope: recovered.envelope });
    assert.equal(first.status, 'applied');
    assert.equal(first.reused, true);
    assert.equal((await reconcileMutation({ db: transport, request: mutation,
      grantId: recovered.grant.grantId })).status, 'applied');
    assert.equal((await executeMutation({ db: transport, config, request: mutation,
      envelope: recovered.envelope })).reused, true);
    assert.equal(writes, 1);
    const counts = await db.query(`SELECT
      (SELECT count(*)::int FROM brain_tasks) AS tasks,
      (SELECT count(*)::int FROM brain_authority_grants) AS grants,
      (SELECT count(*)::int FROM brain_mcp_mutations) AS mutations,
      (SELECT count(*)::int FROM brain_events WHERE event_type='mcp-mutation-observed') AS receipts`);
    assert.deepEqual(counts.rows[0], { tasks: 1, grants: 1, mutations: 1, receipts: 1 });
    const tampered = { ...recovered.envelope, payload: recovered.envelope.payload.replace('pglite-test-01', 'pglite-test-02') };
    assert.equal((await executeMutation({ db: transport, config, request: mutation, envelope: tampered })).status, 'held');
    assert.equal(writes, 1);
    await db.exec('UPDATE brain_runtime_control SET paused=TRUE WHERE id=1');
    const pausedMutation = { ...mutation, key: 'pglite-test-02' };
    const pausedRequest = (await prepareMutation(pausedMutation)).grantRequest;
    const pausedGrant = await signApprovedRequest({ request: pausedRequest, mutation: pausedMutation,
      privateJwk: await webcrypto.subtle.exportKey('jwk', signing.privateKey) });
    const paused = await executeMutation({ db: transport, config, request: pausedMutation, envelope: pausedGrant });
    assert.equal(paused.ok, false);
    const pausedCounts = await db.query(`SELECT
      (SELECT count(*)::int FROM brain_tasks) AS tasks,
      (SELECT count(*)::int FROM brain_authority_grants) AS grants`);
    assert.deepEqual(pausedCounts.rows[0], { tasks: 1, grants: 1 });
  } finally {
    await db.close();
  }
});
