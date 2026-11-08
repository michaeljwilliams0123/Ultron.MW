import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let PGlite;
try {({PGlite}=await import('@electric-sql/pglite'));} catch {}
if(process.env.CI==='true'&&!PGlite) throw Error('pglite-ci-dependency-unavailable');
const skip=PGlite?false:'@electric-sql/pglite not installed';
const migration=name=>readFile(
 new URL('../cloud/hatchable/migrations/'+name,import.meta.url),'utf8');

test('production-shaped 0031-ahead-of-0029 drift reconciles through 0032 without profile expansion or lost rows',
 {skip},async()=>{
 const db=new PGlite();
 try{
  const [m29,m30,m31,m32]=await Promise.all([
   migration('0029_mcp_mutation_ledger.sql'),
   migration('0030_mahoraga_mcp_authority.sql'),
   migration('0031_mcp_provider_writes.sql'),
   migration('0032_gitlab_signed_branch_create.sql')
  ]);
  // Live snapshot on 2026-11-08: release profile v5, 15 operations,
  // no mutation/Mahoraga authority tables, but a provider-write table.
  await db.exec(`
   CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY);
   CREATE TABLE mahoraga_actions(id BIGINT PRIMARY KEY);
   CREATE TABLE brain_owner_autonomy_profile(
    id SMALLINT PRIMARY KEY,owner TEXT NOT NULL,preset TEXT NOT NULL,
    version BIGINT NOT NULL,allowed_operations JSONB NOT NULL,
    max_paid_cents INTEGER NOT NULL,
    CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
     CHECK (jsonb_typeof(allowed_operations)='array'
      AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 21)
   );
   INSERT INTO brain_owner_autonomy_profile
    VALUES(1,'michaeljwilliams0123','release',5,
     (SELECT jsonb_agg('operation-'||n) FROM generate_series(1,15)n),0);
  `);
  await db.exec(m31); // previously deployed partial 0031 side effect
  // Synthetic historical row tests data preservation; production had zero rows.
  await db.exec(`
   INSERT INTO brain_authority_grants VALUES('existing-grant');
   INSERT INTO brain_mcp_provider_writes
    (action_key,operation,fingerprint,resource_key,grant_id,profile_version,stop_version,status)
   VALUES('existing-write','github.issue.write',repeat('a',64),
    repeat('b',64),'existing-grant',5,5,'reconcile-required')
  `);
  for(const sql of [m29,m30,m31,m32]) await db.exec(sql);
  const first=await db.query(`
   SELECT version,preset,max_paid_cents,
    jsonb_array_length(allowed_operations)::int AS operations,
    allowed_operations ? 'gitlab.branch.create' AS gitlab_authorized
   FROM brain_owner_autonomy_profile WHERE id=1`);
  assert.deepEqual(first.rows[0],{
   version:5,preset:'release',max_paid_cents:0,
   operations:15,gitlab_authorized:false
  });
  await db.exec(`
   INSERT INTO brain_authority_grants VALUES('second-grant');
   INSERT INTO brain_mcp_provider_writes
    (action_key,operation,fingerprint,resource_key,grant_id,profile_version,stop_version,status)
   VALUES('gitlab-branch-write','gitlab.branch.create',repeat('c',64),
    repeat('d',64),'second-grant',5,5,'reconcile-required')
  `);
  for(const sql of [m29,m30,m31,m32]) await db.exec(sql);
  const after=await db.query(`
   SELECT (SELECT count(*)::int FROM brain_mcp_provider_writes) AS provider_writes,
    (SELECT count(*)::int FROM brain_authority_grants) AS prior_grants,
    to_regclass('brain_mcp_mutations') IS NOT NULL AS mutations_present,
    to_regclass('mahoraga_mcp_authority') IS NOT NULL AS authority_present,
    jsonb_array_length(allowed_operations)::int AS operations,
    allowed_operations ? 'gitlab.branch.create' AS gitlab_authorized
   FROM brain_owner_autonomy_profile WHERE id=1`);
  assert.deepEqual(after.rows[0],{
   provider_writes:2,prior_grants:2,
   mutations_present:true,authority_present:true,
   operations:15,gitlab_authorized:false
  });
  await assert.rejects(db.exec(`
   UPDATE brain_owner_autonomy_profile SET allowed_operations=
    (SELECT jsonb_agg('op'||n) FROM generate_series(1,23)n) WHERE id=1`),
   /check constraint/);
 }finally{await db.close();}
});
