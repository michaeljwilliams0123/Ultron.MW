import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID} from '../src/github-principal-policy.mjs';

const canonical='Ultron-MW/Ultron.MW';
const old='michaeljwilliams0123/Ultron.MW';

test('signed Task 1–5 operation authority follows the verified transferred repository ID',()=>{
 assert.equal(ULTRON_REPOSITORY,canonical);
 assert.equal(ULTRON_REPOSITORY_ID,1424939667);
});

test('five-stage GitHub canary API target inherits canonical repository from shared policy',async()=>{
 const conductor=await readFile(
  new URL('../scripts/run-canary-pipeline.mjs',import.meta.url),'utf8');
 assert.match(conductor,/import \{ULTRON_REPOSITORY\} from '\.\.\/src\/github-principal-policy\.mjs'/);
 assert.match(conductor,/const REPOSITORY=ULTRON_REPOSITORY/);
 assert.doesNotMatch(conductor,/const REPOSITORY='michaeljwilliams0123\/Ultron\.MW'/);
});

test('forward-only migration 0040 rebinds existing durable ledger constraint without deleting rows',async t=>{
 let PGlite;
 try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
 if(!PGlite){if(process.env.CI==='true')throw Error('PGlite unavailable in CI');
  t.skip('PGlite not installed');return;}
 const earlier=await readFile(
  new URL('../cloud/hatchable/migrations/0039_github_idempotent_executions.sql',import.meta.url),'utf8');
 const forward=await readFile(
  new URL('../cloud/hatchable/migrations/0040_canonical_repository_transfer.sql',import.meta.url),'utf8');
 const db=new PGlite();
 try{
  await db.exec(earlier);
  await db.exec(forward);
  const key='ultron-task-repository-canonical-check';
  const add=async (repository,id)=>db.query(
   "INSERT INTO github_idempotent_executions (idempotency_key,operation_digest,repository,target_branch,persona_role) VALUES ($1,$2,$3,$4,$5)",
   [id,'a'.repeat(64),repository,'ultron/canary-canonical-'+id.slice(-6),'builder']);
  await assert.rejects(add(old,'ultron-task-repository-legacy-denied'));
  await add(canonical,key);
  const rows=await db.query("SELECT repository,state FROM github_idempotent_executions");
  assert.equal(rows.rows.length,1);
  assert.equal(rows.rows[0].repository,canonical);
  assert.equal(rows.rows[0].state,'reserved');
  await assert.rejects(db.query(
   "UPDATE github_idempotent_executions SET repository=$1 WHERE idempotency_key=$2",
   [old,key]));
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
