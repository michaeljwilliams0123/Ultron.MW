import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let PGlite;
try {({PGlite}=await import('@electric-sql/pglite'));} catch{}
if(process.env.CI==='true'&&!PGlite)throw Error('pglite-ci-dependency-unavailable');
const skip=PGlite?false:'@electric-sql/pglite not installed';
const source=name=>readFile(new URL('../cloud/hatchable/migrations/'+name,import.meta.url),'utf8');

test('0032 preserves existing provider writes and extends only the reviewed signed operation', {skip},async()=>{
 const db=new PGlite();
 try{
  const [previous,next]=await Promise.all([
   source('0031_mcp_provider_writes.sql'),
   source('0032_gitlab_signed_branch_create.sql')
  ]);
  await db.exec(`
   CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY);
   CREATE TABLE brain_owner_autonomy_profile(
    id INTEGER PRIMARY KEY,allowed_operations JSONB NOT NULL,
    CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
      CHECK (jsonb_typeof(allowed_operations)='array'
       AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 17)
   );
   INSERT INTO brain_owner_autonomy_profile VALUES (1,'["repo.inspect"]');
  `);
  await db.exec(previous);
  await db.exec(`
   INSERT INTO brain_authority_grants VALUES ('existing-grant'),('new-grant');
   INSERT INTO brain_mcp_provider_writes
    (action_key,operation,fingerprint,resource_key,grant_id,profile_version,stop_version,status)
    VALUES ('github-write-1','github.issue.write',repeat('a',64),repeat('b',64),
     'existing-grant',1,1,'reconcile-required');
  `);
  await db.exec(next);
  await db.exec(`
   UPDATE brain_owner_autonomy_profile
    SET allowed_operations=(SELECT jsonb_agg('op' || n) FROM generate_series(1,22) n)
    WHERE id=1;
   INSERT INTO brain_mcp_provider_writes
    (action_key,operation,fingerprint,resource_key,grant_id,profile_version,stop_version,status)
    VALUES ('gitlab-write-1','gitlab.branch.create',repeat('c',64),repeat('d',64),
     'new-grant',1,1,'reconcile-required');
  `);
  const count=await db.query(`SELECT operation, count(*)::int AS count
    FROM brain_mcp_provider_writes GROUP BY operation ORDER BY operation`);
  assert.deepEqual(count.rows,[
   {operation:'github.issue.write',count:1},
   {operation:'gitlab.branch.create',count:1}
  ]);
  await assert.rejects(db.exec(`UPDATE brain_owner_autonomy_profile SET
    allowed_operations=(SELECT jsonb_agg('op' || n) FROM generate_series(1,23) n)
    WHERE id=1`),/check constraint/);
  await db.exec(next);
  const replay=await db.query(`SELECT count(*)::int AS count FROM brain_mcp_provider_writes`);
  assert.equal(replay.rows[0].count,2);
 }finally{await db.close();}
});
