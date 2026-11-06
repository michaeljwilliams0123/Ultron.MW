import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch {}
const skip = PGlite ? false : '@electric-sql/pglite not installed';
const migration = name => readFile(new URL(`../cloud/hatchable/migrations/${name}`, import.meta.url), 'utf8');

test('partial 0031 state with 18 operations reconciles without data loss', { skip }, async () => {
  const db = new PGlite();
  try {
    const [m29, m30, m31] = await Promise.all([
      migration('0029_mcp_mutation_ledger.sql'),
      migration('0030_mahoraga_mcp_authority.sql'),
      migration('0031_mcp_provider_writes.sql')
    ]);
    await db.exec(`
      CREATE TABLE brain_authority_grants (grant_id TEXT PRIMARY KEY);
      CREATE TABLE mahoraga_actions (id BIGINT PRIMARY KEY);
      CREATE TABLE brain_owner_autonomy_profile (
        id INTEGER PRIMARY KEY,
        allowed_operations JSONB NOT NULL,
        CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
          CHECK (jsonb_typeof(allowed_operations)='array'
            AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 17)
      );
      INSERT INTO brain_owner_autonomy_profile VALUES (1, '["repo.inspect"]');
    `);
    await db.exec(m31);
    await db.exec(`
      INSERT INTO brain_authority_grants VALUES ('existing-grant');
      INSERT INTO brain_mcp_provider_writes
        (action_key,operation,fingerprint,resource_key,grant_id,profile_version,stop_version,status)
      VALUES ('existing-write','github.issue.write',repeat('a',64),repeat('b',64),
        'existing-grant',1,1,'reconcile-required');
      UPDATE brain_owner_autonomy_profile
        SET allowed_operations = (SELECT jsonb_agg('op' || n)
          FROM generate_series(1,18) AS n) WHERE id=1;
    `);
    await db.exec(`BEGIN;\n${m29}\nCOMMIT;`);
    await db.exec(`UPDATE brain_owner_autonomy_profile
      SET allowed_operations = (SELECT jsonb_agg('op' || n)
        FROM generate_series(1,21) AS n) WHERE id=1;`);
    await assert.rejects(db.exec(`UPDATE brain_owner_autonomy_profile
      SET allowed_operations = (SELECT jsonb_agg('op' || n)
        FROM generate_series(1,22) AS n) WHERE id=1;`), /check constraint/);
    await db.exec(`UPDATE brain_owner_autonomy_profile
      SET allowed_operations = (SELECT jsonb_agg('op' || n)
        FROM generate_series(1,18) AS n) WHERE id=1;`);
    await db.exec(`INSERT INTO brain_authority_grants VALUES ('resume-grant');
      INSERT INTO brain_mcp_mutations VALUES
        ('resume-key',repeat('c',64),'mcp.queue.submit','resume-grant',now());`);
    await db.exec(`BEGIN;\n${m29}\nCOMMIT;`);
    const afterResume = await db.query(`SELECT count(*)::int AS mutations
      FROM brain_mcp_mutations WHERE action_key='resume-key'`);
    assert.deepEqual(afterResume.rows[0], { mutations: 1 });
    await db.exec(`BEGIN;\n${m30}\n${m31}\nCOMMIT;`);
    const afterReconciliation = await db.query(`SELECT
      (SELECT count(*)::int FROM brain_mcp_provider_writes) AS writes,
      jsonb_array_length(allowed_operations) AS operations
      FROM brain_owner_autonomy_profile WHERE id=1`);
    assert.deepEqual(afterReconciliation.rows[0], { writes: 1, operations: 18 });
    const reconciled = await db.query(`SELECT
      to_regclass('brain_mcp_mutations') AS mutations,
      to_regclass('mahoraga_mcp_authority') AS authority,
      (SELECT count(*)::int FROM brain_mcp_provider_writes
        WHERE action_key='existing-write' AND status='reconcile-required') AS existing_write`);
    assert.deepEqual(reconciled.rows[0], {
      mutations: 'brain_mcp_mutations',
      authority: 'mahoraga_mcp_authority',
      existing_write: 1
    });
    await db.exec(`INSERT INTO brain_authority_grants VALUES ('mutation-grant');
      INSERT INTO brain_mcp_mutations VALUES
        ('mutation-key',repeat('a',64),'mcp.queue.submit','mutation-grant',now())`);
    await assert.rejects(db.exec(`DELETE FROM brain_mcp_mutations WHERE action_key='mutation-key'`),
      /immutable/);
  } finally {
    await db.close();
  }
});
