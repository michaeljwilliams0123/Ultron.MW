import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const relative=(name)=>new URL('../cloud/hatchable/migrations/'+name,import.meta.url);
const read=(name)=>readFile(relative(name),'utf8');
const credentialId='adminpasskeycredential001';
const digest='a'.repeat(64);

test('0046 exists and introduces separate, default-deny Admin passkey scope',async()=>{
 const sql=await read('0046_admin_passkey_stepup.sql');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS brain_admin_passkey_capabilities/i);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS brain_admin_passkey_stepup_challenges/i);
 assert.match(sql,/DEFAULT FALSE/);
 assert.doesNotMatch(sql,/allow_(?:admin_executor|vault_custody|signed_events)\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i);
 assert.match(sql,/administrative_change BOOLEAN NOT NULL DEFAULT TRUE CHECK \(administrative_change\)/);
 assert.doesNotMatch(sql,/ALTER TABLE brain_owner_passkey_challenges/i);
 assert.doesNotMatch(sql,/UPDATE brain_owner_autonomy_profile/i);
 assert.doesNotMatch(sql,/DROP (TABLE|CONSTRAINT).*brain_owner_passkey/i);
 for(const op of ['actions.dispatch','actions.rerun_failed','actions.cancel',
  'actions.enable','actions.disable','repository.settings.update',
  'webhooks.ping','vault.custody.access','signed.event.emit']){
  assert.ok(sql.includes(op),'missing strict operation '+op);
 }
});

test('real PostgreSQL preserves old passkey fences and denies unauthorised Admin step-up',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(await read('0008_admin_grants.sql'));
  await db.exec(`CREATE TABLE brain_owner_autonomy_profile(
 id SMALLINT PRIMARY KEY,owner TEXT NOT NULL,preset TEXT NOT NULL,
 allowed_operations JSONB NOT NULL,max_paid_cents INTEGER NOT NULL,
 version BIGINT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK(jsonb_typeof(allowed_operations)='array'
 AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 22));
 INSERT INTO brain_owner_autonomy_profile
 (id,owner,preset,allowed_operations,max_paid_cents,version)
 VALUES(1,'michaeljwilliams0123','release','["repo.inspect","gitlab.branch.create"]',0,6);`);
  await db.exec(await read('0033_owner_passkey_authority.sql'));
  await db.exec(await read('0034_owner_passkey_enrollment.sql'));
  await db.exec(await read('0046_admin_passkey_stepup.sql'));
  await db.exec(await read('0046_admin_passkey_stepup.sql')); // idempotent DDL
  const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_name LIKE 'brain_admin_passkey_%' ORDER BY table_name")).rows.map(x=>x.table_name);
  assert.deepEqual(tables,['brain_admin_passkey_capabilities','brain_admin_passkey_stepup_challenges']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM brain_admin_passkey_capabilities')).rows[0].n,0);
  const grant='test-owner-enrolment-grant-001';
  await db.query("INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')",
   [grant,'phase0-testing','mcp:ultron','owner.passkey.enroll','owner-passkey:'+credentialId,digest]);
  await db.query("INSERT INTO brain_owner_passkeys(credential_id,public_key_spki,label,enrollment_key,enrollment_fingerprint,enrolled_grant_id) VALUES($1,$2,$3,$4,$5,$6)",
   [credentialId,'A'.repeat(100),'test credential','admin-test-enroll-0001',digest,grant]);
  await db.query('INSERT INTO brain_admin_passkey_capabilities(credential_id) VALUES($1)',[credentialId]);
  const c=(await db.query('SELECT allow_admin_executor,allow_vault_custody,allow_signed_events FROM brain_admin_passkey_capabilities WHERE credential_id=$1',[credentialId])).rows[0];
  assert.deepEqual(c,{allow_admin_executor:false,allow_vault_custody:false,allow_signed_events:false});
  const status=(await db.query('SELECT can_admin_executor,can_vault_custody,can_signed_events FROM brain_admin_passkey_effective_capabilities WHERE credential_id=$1',[credentialId])).rows[0];
  assert.deepEqual(status,{can_admin_executor:false,can_vault_custody:false,can_signed_events:false});
  await assert.rejects(db.query('UPDATE brain_admin_passkey_capabilities SET allow_admin_executor=TRUE WHERE credential_id=$1',[credentialId]),/check constraint|owner-grant|approval|denied/);
  const scopeGrant='admin-capability-exact-scope-001';
  const scope='owner-passkey:'+credentialId+':admin=true:vault=false:events=false';
  await db.query("INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at) VALUES($1,$2,'mcp:ultron','owner.admin.passkey.enable',$3,$4,now()+interval '4 minutes')",[scopeGrant,'phase0-test',scope,digest]);
  await assert.rejects(db.query("UPDATE brain_admin_passkey_capabilities SET allow_admin_executor=TRUE,approval_grant_id=$2,approved_until=now()+interval '30 minutes' WHERE credential_id=$1",[credentialId,scopeGrant]),/owner-grant-required/);
  await db.query("UPDATE brain_admin_passkey_capabilities SET allow_admin_executor=TRUE,approval_grant_id=$2,approved_until=now()+interval '2 minutes' WHERE credential_id=$1",[credentialId,scopeGrant]);
  const effective=(await db.query('SELECT can_admin_executor,can_vault_custody,can_signed_events FROM brain_admin_passkey_effective_capabilities WHERE credential_id=$1',[credentialId])).rows[0];
  assert.deepEqual(effective,{can_admin_executor:true,can_vault_custody:false,can_signed_events:false});
  await assert.rejects(db.query('UPDATE brain_admin_passkey_capabilities SET allow_vault_custody=TRUE WHERE credential_id=$1',[credentialId]),/owner-grant-required/);
  await assert.rejects(db.query('INSERT INTO brain_admin_passkey_stepup_challenges(challenge_id,challenge,credential_id,actor,operation,resource,policy_sha,profile_version,stop_version,expires_at,administrative_change) VALUES($1,$2,$3,$4,$5,$6,$7,1,1,now()+interval \'3 minutes\',FALSE)',
   ['admin-stepup-testing-001','b'.repeat(43),credentialId,'mcp:ultron','actions.disable','ultron:github:michaeljwilliams0123/Ultron.MW:sha256:'+digest,digest]),/check constraint|admin-passkey-stepup-owner-grant-unbound/);
  await assert.rejects(db.query('INSERT INTO brain_admin_passkey_stepup_challenges(challenge_id,challenge,credential_id,actor,operation,resource,policy_sha,profile_version,stop_version,expires_at,administrative_change) VALUES($1,$2,$3,$4,$5,$6,$7,1,1,now()+interval \'3 minutes\',TRUE)',
   ['admin-stepup-testing-002','c'.repeat(43),credentialId,'mcp:ultron','admin.executor.invoke','ultron:github:michaeljwilliams0123/Ultron.MW:sha256:'+digest,digest]),/check constraint|admin-passkey-stepup-owner-grant-unbound/);
  await assert.rejects(db.query('INSERT INTO brain_owner_passkey_challenges(grant_id,challenge,credential_id,actor,objective_id,operation,resource,policy_sha,administrative_change,profile_version,stop_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,1,1,now()+interval \'3 minutes\')',
   ['passkey-test-1234567890123456','d'.repeat(43),credentialId,'mcp:ultron','phase0-testing','actions.disable','sha256:'+digest,digest]),/check constraint|admin-passkey-stepup-owner-grant-unbound/);
 }finally{await db.close();}
});

test('admin challenge replay and post-consumption mutation are rejected',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(await read('0008_admin_grants.sql'));
  await db.exec(`CREATE TABLE brain_owner_autonomy_profile(
 id SMALLINT PRIMARY KEY,owner TEXT NOT NULL,preset TEXT NOT NULL,
 allowed_operations JSONB NOT NULL,max_paid_cents INTEGER NOT NULL,
 version BIGINT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT brain_owner_autonomy_profile_allowed_operations_check
 CHECK(jsonb_typeof(allowed_operations)='array'
 AND jsonb_array_length(allowed_operations) BETWEEN 1 AND 22));
 INSERT INTO brain_owner_autonomy_profile
 (id,owner,preset,allowed_operations,max_paid_cents,version)
 VALUES(1,'michaeljwilliams0123','release','["repo.inspect","gitlab.branch.create"]',0,6);`);
  await db.exec(await read('0033_owner_passkey_authority.sql'));
  await db.exec(await read('0034_owner_passkey_enrollment.sql'));
  await db.exec(await read('0046_admin_passkey_stepup.sql'));
  const g='test-owner-enrolment-grant-002';
  await db.query("INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at) VALUES($1,$2,'mcp:ultron','owner.passkey.enroll',$3,$4,now()+interval '5 minutes')",[g,'phase0-testing','owner-passkey:'+credentialId,digest]);
  await db.query('INSERT INTO brain_owner_passkeys(credential_id,public_key_spki,label,enrollment_key,enrollment_fingerprint,enrolled_grant_id) VALUES($1,$2,$3,$4,$5,$6)',
   [credentialId,'A'.repeat(100),'test credential','admin-test-enroll-0002',digest,g]);
  const grant='admin-exact-plan-grant-0001';
  const resource='ultron:github:michaeljwilliams0123/Ultron.MW:sha256:'+digest;
  await db.query("INSERT INTO brain_authority_grants(grant_id,objective_id,actor,operation,resource,policy_sha,expires_at) VALUES($1,$2,'mcp:ultron','actions.disable',$3,$4,now()+interval '4 minutes')",[grant,'phase0-testing',resource,digest]);
  const values=['admin-stepup-challenge-0001','z'.repeat(43),credentialId,grant,'mcp:ultron','actions.disable',resource,digest];
  await db.query("INSERT INTO brain_admin_passkey_stepup_challenges(challenge_id,challenge,credential_id,owner_grant_id,actor,operation,resource,policy_sha,administrative_change,profile_version,stop_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,1,1,now()+interval '3 minutes')",values);
  await assert.rejects(db.query("UPDATE brain_admin_passkey_stepup_challenges SET consumed_at=now() WHERE challenge_id=$1",[values[0]]),/check constraint|verification-required|unverified/);
  await db.query("UPDATE brain_admin_passkey_stepup_challenges SET verified_at=now(),consumed_at=now() WHERE challenge_id=$1",[values[0]]);
  await assert.rejects(db.query("UPDATE brain_admin_passkey_stepup_challenges SET consumed_at=now()+interval '1 second' WHERE challenge_id=$1",[values[0]]),/immutable|consumed|denied/);
  await assert.rejects(db.query("DELETE FROM brain_admin_passkey_stepup_challenges WHERE challenge_id=$1",[values[0]]),/immutable|delet|denied/);
 }finally{await db.close();}
});
