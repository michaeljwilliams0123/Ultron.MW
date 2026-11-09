import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let PGlite;try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
if(process.env.CI==='true'&&!PGlite)throw Error('pglite-ci-dependency-unavailable');
const migration=n=>readFile(new URL('../cloud/hatchable/migrations/'+n,import.meta.url),'utf8');
test('0034 adds owner-approved enrollment prerequisite with one-time version bump',{skip:!PGlite},async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE TABLE brain_owner_autonomy_profile (
    id SMALLINT PRIMARY KEY,owner TEXT NOT NULL,preset TEXT NOT NULL,
    allowed_operations JSONB NOT NULL,max_paid_cents INTEGER NOT NULL,
    version BIGINT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
     CHECK(jsonb_typeof(allowed_operations)='array' AND
      jsonb_array_length(allowed_operations) BETWEEN 1 AND 22));
   INSERT INTO brain_owner_autonomy_profile(id,owner,preset,allowed_operations,max_paid_cents,version)
   VALUES (1,'michaeljwilliams0123','release','["repo.inspect","gitlab.branch.create"]',0,6);
   CREATE TABLE brain_runtime_control(id SMALLINT PRIMARY KEY,paused BOOLEAN NOT NULL,version BIGINT NOT NULL);
   INSERT INTO brain_runtime_control VALUES (1,false,5);
   CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY,objective_id TEXT NOT NULL,
    actor TEXT NOT NULL,operation TEXT NOT NULL,resource TEXT NOT NULL,
    policy_sha TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
   CREATE TABLE brain_events(id BIGSERIAL PRIMARY KEY,event_type TEXT NOT NULL,details JSONB NOT NULL);
  `);
  await db.exec(await migration('0033_owner_passkey_authority.sql'));
  const sql=await migration('0034_owner_passkey_enrollment.sql');
  await db.exec(sql);await db.exec(sql);
  const r=await db.query(`SELECT version,max_paid_cents,
    jsonb_exists(allowed_operations,'owner.passkey.enroll') AS enrolled
    FROM brain_owner_autonomy_profile WHERE id=1`);
  assert.deepEqual(r.rows[0],{version:7,max_paid_cents:0,enrolled:true});
  const names=await db.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name='brain_owner_passkey_enrollments'`);
  assert.equal(names.rows.length,1);
  await assert.rejects(db.query(`INSERT INTO brain_owner_passkey_enrollments
   (enrollment_key,label,challenge,fingerprint,policy_sha,profile_version,stop_version,expires_at)
   VALUES('samekeyaa','Test','x','y','z',7,5,now() + interval '30 minutes')`),/check constraint/);
 }finally{await db.close();}
});
