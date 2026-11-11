import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID} from '../src/github-principal-policy.mjs';

const canonical='michaeljwilliams0123/Ultron.MW';
const old='Ultron-MW/Ultron.MW';

test('signed Task 1–5 operation authority follows the verified current repository ID',()=>{
 assert.equal(ULTRON_REPOSITORY,canonical);
 assert.equal(ULTRON_REPOSITORY_ID,1424939667);
});

test('five-stage GitHub canary API target inherits canonical repository from shared policy',async()=>{
 const conductor=await readFile(
  new URL('../src/engine/master-pipeline.mjs',import.meta.url),'utf8');
 assert.match(conductor,/import \{ULTRON_REPOSITORY\} from '\.\.\/github-principal-policy\.mjs'/);
 assert.match(conductor,/const REPOSITORY=ULTRON_REPOSITORY/);
 assert.doesNotMatch(conductor,/const REPOSITORY='michaeljwilliams0123\/Ultron\.MW'/);
 const cli=await readFile(
  new URL('../scripts/run-canary-pipeline.mjs',import.meta.url),'utf8');
 assert.match(cli,/from '\.\.\/src\/engine\/master-pipeline\.mjs'/);
 assert.doesNotMatch(cli,/michaeljwilliams0123\/Ultron\.MW/);
});

test('forward migration retains legacy receipt and admits canonical writes',async t=>{
 let PGlite;
 try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
 if(!PGlite){if(process.env.CI==='true')throw Error('PGlite unavailable in CI');
  t.skip('PGlite not installed');return;}
 const earlierOutbox=await readFile(new URL('../cloud/hatchable/migrations/0013_continuum_outbox.sql',import.meta.url),'utf8');
 const earlierExecutor=await readFile(new URL('../cloud/hatchable/migrations/0039_github_idempotent_executions.sql',import.meta.url),'utf8');
 const forward=await readFile(new URL('../cloud/hatchable/migrations/0040_ultron_org_transfer.sql',import.meta.url),'utf8');
 const db=new PGlite();
 try{
  await db.exec('CREATE TABLE brain_tasks (id bigint PRIMARY KEY)');
  await db.exec(earlierOutbox);
  await db.exec(earlierExecutor);
  const legacyKey='ultron-task-historical-0001';
  const legacyBranch='ultron/legacy-historical';
  const receipt={idempotencyKey:legacyKey,status:'success',details:{
   operationDigest:'a'.repeat(64),repository:old,branch:legacyBranch,
   personaRole:'builder',remoteVerified:true,sha:'b'.repeat(40)}};
  await db.exec(forward);
  await db.query(
   "INSERT INTO github_idempotent_executions "+
   "(idempotency_key,operation_digest,repository,target_branch,persona_role,state,receipt) "+
   "VALUES($1,$2,$3,$4,'builder','completed',$5::jsonb)",
   [legacyKey,'a'.repeat(64),old,legacyBranch,JSON.stringify(receipt)]);
  await db.query('INSERT INTO brain_tasks(id) VALUES(1)');
  await db.query(
   "INSERT INTO brain_continuum_outbox "+
   "(task_id,objective_id,delivery_id,idempotency_key,repository,source_sha, "+
   "authority_sha,request_sha,lease_generation,expires_at,effect) "+
   "VALUES(1,'objective-old','delivery-old','outbox-old',$1,$2,$3,$4,1, "+
   "NOW() + interval '1 hour','read')",
   [old,'b'.repeat(40),'c'.repeat(64),'d'.repeat(64)]);
  await db.exec(forward);
  const newKey='ultron-task-canonical-0002';
  await db.query(
   "INSERT INTO github_idempotent_executions "+
   "(idempotency_key,operation_digest,repository,target_branch,persona_role) "+
   "VALUES($1,$2,$3,$4,'builder')",
   [newKey,'a'.repeat(64),canonical,'ultron/canonical-current']);
  const rows=await db.query('SELECT idempotency_key,repository,state,receipt FROM github_idempotent_executions');
  assert.equal(rows.rows.length,2);
  const history=rows.rows.find(x=>x.idempotency_key===legacyKey);
  const current=rows.rows.find(x=>x.idempotency_key===newKey);
  assert.equal(history.repository,old);
  assert.equal(history.state,'completed');
  assert.deepEqual(history.receipt,receipt);
  assert.equal(current.repository,canonical);
  assert.equal(current.state,'reserved');
  const outbox=await db.query('SELECT repository FROM brain_continuum_outbox');
  assert.deepEqual(outbox.rows.map(x=>x.repository),[old]);
  await assert.rejects(db.query('UPDATE github_idempotent_executions SET repository=$1 WHERE idempotency_key=$2',
   [canonical,legacyKey]));
  await assert.rejects(db.query('UPDATE brain_continuum_outbox SET repository=$1 WHERE idempotency_key=$2',
   [canonical,'outbox-old']));
  const triggers=await db.query(
   "SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='github_idempotent_executions' AND trigger_name='github_idempotent_executions_guard_trg'");
  assert.ok(triggers.rows.length>=1);
 }finally{await db.close();}
});

test('legacy owner grants never become valid merely through repository redirects',async()=>{
 const {assertOperationAuthorization}=await import('../src/github-principal-policy.mjs');
 const now='2026-11-10T12:00:00.000Z';
 const authorization={source:'owner-standing-authorization',verified:true,
  actor:'michaeljwilliams0123',repository:old,operation:'repair.branch.create',
  planDigest:'a'.repeat(64),idempotencyKey:'ultron-task-canonical-check',
  installationId:44551,grantId:'canonical-grant-check-0001',
  expiresAt:'2026-11-10T12:02:00.000Z'};
 assert.throws(()=>assertOperationAuthorization(authorization,{
  operation:'repair.branch.create',planDigest:'a'.repeat(64),
  idempotencyKey:'ultron-task-canonical-check',installationId:44551,now}),/authorization invalid/i);
});
