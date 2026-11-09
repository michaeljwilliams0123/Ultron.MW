import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let PGlite;
try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
if(process.env.CI==='true'&&!PGlite)throw Error('pglite-ci-dependency-unavailable');
const skip=PGlite?false:'@electric-sql/pglite not installed';
const migration=()=>readFile(new URL(
 '../cloud/hatchable/migrations/0033_owner_passkey_authority.sql',import.meta.url),'utf8');

test('0033 adds bounded owner passkey schema without altering owner authorization',{skip},async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE TABLE brain_authority_grants(
    grant_id TEXT PRIMARY KEY,objective_id TEXT NOT NULL,actor TEXT NOT NULL,
    operation TEXT NOT NULL,resource TEXT NOT NULL,policy_sha TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
   );
   CREATE TABLE brain_events(
    id BIGSERIAL PRIMARY KEY,event_type TEXT NOT NULL,details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE TABLE brain_owner_autonomy_profile(
    id SMALLINT PRIMARY KEY,owner TEXT NOT NULL,preset TEXT NOT NULL,
    allowed_operations JSONB NOT NULL,max_paid_cents INTEGER NOT NULL,version BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
     CHECK(jsonb_typeof(allowed_operations)='array'
      AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 22)
   );
   INSERT INTO brain_owner_autonomy_profile
    (id,owner,preset,allowed_operations,max_paid_cents,version) VALUES
    (1,'michaeljwilliams0123','release','["repo.inspect","gitlab.branch.create"]',0,6);
  `);
  const sql=await migration();
  await db.exec(sql);
  const first=await db.query(`SELECT version,
   allowed_operations ? 'owner.passkey.enroll' AS enrollment,
   jsonb_array_length(allowed_operations)::int AS operations,
   to_regclass('brain_owner_passkeys') IS NOT NULL AS passkeys,
   to_regclass('brain_owner_passkey_challenges') IS NOT NULL AS challenges
   FROM brain_owner_autonomy_profile WHERE id=1`);
  assert.deepEqual(first.rows[0],{
   version:6,enrollment:false,operations:2,passkeys:true,challenges:true
  });
  await db.exec(sql);
  const replay=await db.query(`SELECT version,
   jsonb_array_length(allowed_operations)::int AS operations
   FROM brain_owner_autonomy_profile WHERE id=1`);
  assert.deepEqual(replay.rows[0],{version:6,operations:2});
  await assert.rejects(db.exec(`UPDATE brain_owner_autonomy_profile SET
   allowed_operations=(SELECT jsonb_agg('op'||n) FROM generate_series(1,24)n)
   WHERE id=1`),/check constraint/);
 }finally{await db.close();}
});
