import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {}
if (process.env.CI === 'true' && !PGlite)
  throw new Error('pglite-ci-dependency-unavailable');
const skip = PGlite ? false : '@electric-sql/pglite not installed';
const file = name => readFile(new URL(`../cloud/hatchable/migrations/${name}`, import.meta.url), 'utf8');

async function signGrant(grantRequest, privateKey, grantId) {
  const now = Date.now();
  const payload = JSON.stringify({ schema: 'ultron.security-grant.v1',
    issuer:'ultron-owner-authority',authorizedBy:'michaeljwilliams0123', audience: 'ultron-cloud-brain', grantId,
    policySha: 'a'.repeat(64), notBefore: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(), ...grantRequest });
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
    privateKey, new TextEncoder().encode(payload));
  return { payload, signature: Buffer.from(signature).toString('base64url') };
}

test('signed grant commits once and reconciles a lost response in PostgreSQL', { skip }, async () => {
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
    const signerPublicJwk = await webcrypto.subtle.exportKey('jwk', signing.publicKey);
    const mutation = { operation: 'mcp.queue.submit', key: 'pglite-test-01', objective: 'repo.inspect',
      expectedProfileVersion: 2, expectedStopVersion: 1 };
    const { grantRequest } = await prepareMutation(mutation);
    const envelope = await signGrant(grantRequest, signing.privateKey, 'pglite-grant-01');
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
    const first = await executeMutation({ db: transport, config, request: mutation, envelope });
    assert.equal(first.status, 'applied');
    assert.equal(first.reused, true);
    assert.equal((await reconcileMutation({ db: transport, request: mutation,
      grantId: 'pglite-grant-01' })).status, 'applied');
    assert.equal((await executeMutation({ db: transport, config, request: mutation,
      envelope })).reused, true);
    assert.equal(writes, 1);
    const counts = await db.query(`SELECT
      (SELECT count(*)::int FROM brain_tasks) AS tasks,
      (SELECT count(*)::int FROM brain_authority_grants) AS grants,
      (SELECT count(*)::int FROM brain_mcp_mutations) AS mutations,
      (SELECT count(*)::int FROM brain_events WHERE event_type='mcp-mutation-observed') AS receipts`);
    assert.deepEqual(counts.rows[0], { tasks: 1, grants: 1, mutations: 1, receipts: 1 });
    const tampered = { ...envelope, payload: envelope.payload.replace('pglite-test-01', 'pglite-test-02') };
    assert.equal((await executeMutation({ db: transport, config, request: mutation, envelope: tampered })).status, 'held');
    assert.equal(writes, 1);
    await db.exec('UPDATE brain_runtime_control SET paused=TRUE WHERE id=1');
    const pausedMutation = { ...mutation, key: 'pglite-test-02' };
    const pausedRequest = (await prepareMutation(pausedMutation)).grantRequest;
    const pausedGrant = await signGrant(pausedRequest, signing.privateKey, 'pglite-grant-02');
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
