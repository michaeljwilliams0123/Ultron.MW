import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {
 normalizeDeploymentReceiptRequest,deploymentReceiptResource,
 deploymentArtifactDigest,prepareDeploymentReleaseReceipt,
 submitDeploymentReleaseReceipt,
 DEPLOYMENT_RECEIPT_POLICY_SHA
} from '../cloud/hatchable/lib/deployment-release-receipt.js';

const input={key:'deploy-v137-main',target:'hatchable-v137',
 sourceSha:'a'.repeat(40),artifactDigest:'sha256:'+'b'.repeat(64),
 manifestFileCount:255,independentReadback:true};

test('deployment receipt request is exact, bounded and deterministically digested',()=>{
 assert.deepEqual(normalizeDeploymentReceiptRequest(input),input);
 assert.equal(normalizeDeploymentReceiptRequest({...input,authorized:true}),null);
 assert.equal(normalizeDeploymentReceiptRequest({...input,independentReadback:false}),null);
 const accessor={...input};
 Object.defineProperty(accessor,'key',{enumerable:true,get(){throw Error('trap');}});
 assert.equal(normalizeDeploymentReceiptRequest(accessor),null);
 assert.equal(normalizeDeploymentReceiptRequest(Object.assign(Object.create({
  authorized:true}),input)),null);
 assert.equal(deploymentReceiptResource(input),
  'hatchable:deployment:proj_A6GCXRSKizko:hatchable-v137:'+
  input.artifactDigest+':source:'+input.sourceSha);
 const a=deploymentArtifactDigest([
  {path:'b.js',hash:'2'.repeat(64)},{path:'a.js',hash:'1'.repeat(64)}]);
 const b=deploymentArtifactDigest([
  {path:'a.js',hash:'1'.repeat(64)},{path:'b.js',hash:'2'.repeat(64)}]);
 assert.equal(a,b);assert.match(a,/^sha256:[a-f0-9]{64}$/);
 assert.throws(()=>deploymentArtifactDigest([
  {path:'a.js',hash:'1'.repeat(64)},{path:'a.js',hash:'2'.repeat(64)}]));
});

test('prepare binds the current owner profile, stop version and receipt policy',async()=>{
 const db={query:async()=>({rows:[{owner:'michaeljwilliams0123',preset:'release',
  profile_version:8,max_paid_cents:0,
  allowed_operations:['cloud.deploy'],paused:false,stop_version:5}]})};
 const result=await prepareDeploymentReleaseReceipt({db,request:input});
 assert.equal(result.status,'prepared');
 assert.deepEqual(result.grantRequest,{
  actor:'mcp:ultron',objectiveId:input.key,operation:'cloud.deploy',
  resource:deploymentReceiptResource(input),administrativeChange:false,
  profileVersion:8,stopVersion:5,policySha:DEPLOYMENT_RECEIPT_POLICY_SHA
 });
 const denied=await prepareDeploymentReleaseReceipt({db:{query:async()=>({rows:[{
  owner:'michaeljwilliams0123',preset:'release',profile_version:8,
  max_paid_cents:1,allowed_operations:['cloud.deploy'],
  paused:false,stop_version:5}]})},request:input});
 assert.equal(denied.reason,'authority-denied');
});

test('signed submission atomically records one immutable grant-bound receipt',async()=>{
 const subtle=webcrypto.subtle;
 const pair=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const now=Date.now();
 const grant={schema:'ultron.security-grant.v1',grantId:'owner-deploy-v137-main',
  issuer:'ultron-owner-authority',authorizedBy:'michaeljwilliams0123',
  audience:'ultron-cloud-brain',actor:'mcp:ultron',objectiveId:input.key,
  operation:'cloud.deploy',resource:deploymentReceiptResource(input),
  policySha:DEPLOYMENT_RECEIPT_POLICY_SHA,
  notBefore:new Date(now-30_000).toISOString(),
  expiresAt:new Date(now+5*60_000).toISOString(),administrativeChange:false,
  profileVersion:8,stopVersion:5};
 const payload=JSON.stringify(grant);
 const signature=Buffer.from(await subtle.sign({name:'ECDSA',hash:'SHA-256'},
  pair.privateKey,new TextEncoder().encode(payload))).toString('base64url');
 let sql='';
 const db={query:async(statement,params)=>{
  sql=statement;
  assert.equal(params[0],input.key);assert.equal(params[1],grant.grantId);
  return {rows:[{outcome:'recorded',receipt_id:41,receipt_key:input.key,
   target:input.target,source_sha:input.sourceSha,artifact_digest:input.artifactDigest,
   manifest_file_count:input.manifestFileCount,independent_readback:true,
   grant_id:grant.grantId,policy_sha:DEPLOYMENT_RECEIPT_POLICY_SHA,
   profile_version:8,stop_version:5,event_id:900}]};
 }};
 const publicJwk=await subtle.exportKey('jwk',pair.publicKey);
 const result=await submitDeploymentReleaseReceipt({db,
  config:{get:async()=>JSON.stringify(publicJwk)},request:input,
  envelope:{payload,signature},
  verifyManifest:async()=>({verified:true,target:input.target,
   sourceSha:input.sourceSha,artifactDigest:input.artifactDigest,manifestFileCount:input.manifestFileCount})});
 assert.equal(result.ok,true);assert.equal(result.status,'observed');
 assert.equal(result.receiptId,'41');assert.equal(result.grantId,grant.grantId);
 assert.match(sql,/INSERT INTO brain_authority_grants/);
 assert.match(sql,/INSERT INTO brain_deployment_release_receipts/);
 assert.match(sql,/deployment-release-receipt-recorded/);
 assert.match(sql,/jsonb_exists\(a.allowed_operations,'cloud\.deploy'\)/);
});

test('0051 is repeatable, versions authority once and makes receipts append-only',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE brain_authority_grants(
   grant_id TEXT PRIMARY KEY,objective_id TEXT,actor TEXT,operation TEXT,
   resource TEXT,policy_sha TEXT,expires_at TIMESTAMPTZ);
  CREATE TABLE brain_owner_autonomy_profile(
   id INTEGER PRIMARY KEY,owner TEXT,preset TEXT,allowed_operations JSONB,
   version INTEGER,updated_at TIMESTAMPTZ DEFAULT now());
  INSERT INTO brain_owner_autonomy_profile VALUES
   (1,'michaeljwilliams0123','release','["repo.inspect"]',7,now());`);
 const migration=readFileSync(new URL(
  '../cloud/hatchable/migrations/0051_deployment_release_receipts.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration);
 const profile=(await db.query(`SELECT version,allowed_operations
  FROM brain_owner_autonomy_profile WHERE id=1`)).rows[0];
 assert.equal(profile.version,8);
 assert.equal(profile.allowed_operations.filter(x=>x==='cloud.deploy').length,1);
 await db.query(`INSERT INTO brain_authority_grants VALUES
  ('owner-deploy-v137-main','deploy-v137-main','mcp:ultron','cloud.deploy',
   $1,$2,now()+interval '5 minutes')`,[deploymentReceiptResource(input),
   DEPLOYMENT_RECEIPT_POLICY_SHA]);
 await db.query(`INSERT INTO brain_deployment_release_receipts(
  receipt_key,target,source_sha,artifact_digest,manifest_file_count,
  independent_readback,grant_id,policy_sha,profile_version,stop_version)
  VALUES($1,$2,$3,$4,$5,true,'owner-deploy-v137-main',$6,8,5)`,
  [input.key,input.target,input.sourceSha,input.artifactDigest,
   input.manifestFileCount,DEPLOYMENT_RECEIPT_POLICY_SHA]);
 await assert.rejects(db.query(`UPDATE brain_deployment_release_receipts
  SET target='hatchable-v138' WHERE receipt_key=$1`,[input.key]),/immutable/);
 await assert.rejects(db.query(`DELETE FROM brain_deployment_release_receipts
  WHERE receipt_key=$1`,[input.key]),/immutable/);
});

test('real PostgreSQL-compatible reservation consumes once and replays by readback',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`CREATE TABLE brain_authority_grants(
   grant_id TEXT PRIMARY KEY,objective_id TEXT NOT NULL,actor TEXT NOT NULL,
   operation TEXT NOT NULL,resource TEXT NOT NULL,policy_sha TEXT NOT NULL,
   expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE brain_owner_autonomy_profile(
   id INTEGER PRIMARY KEY,owner TEXT,preset TEXT,allowed_operations JSONB,
   version INTEGER,updated_at TIMESTAMPTZ DEFAULT now(),max_paid_cents INTEGER);
  CREATE TABLE brain_runtime_control(id INTEGER PRIMARY KEY,paused BOOLEAN,version INTEGER);
  CREATE TABLE brain_events(id BIGSERIAL PRIMARY KEY,event_type TEXT,details JSONB);
  INSERT INTO brain_owner_autonomy_profile VALUES
   (1,'michaeljwilliams0123','release','["repo.inspect"]',7,now(),0);
  INSERT INTO brain_runtime_control VALUES(1,false,5);`);
 const migration=readFileSync(new URL(
  '../cloud/hatchable/migrations/0051_deployment_release_receipts.sql',import.meta.url),'utf8');
 await db.exec(migration);
 const subtle=webcrypto.subtle;
 const pair=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const now=Date.now(),grant={schema:'ultron.security-grant.v1',
  grantId:'owner-deploy-v137-pg',issuer:'ultron-owner-authority',
  authorizedBy:'michaeljwilliams0123',audience:'ultron-cloud-brain',
  actor:'mcp:ultron',objectiveId:input.key,operation:'cloud.deploy',
  resource:deploymentReceiptResource(input),policySha:DEPLOYMENT_RECEIPT_POLICY_SHA,
  notBefore:new Date(now-30_000).toISOString(),expiresAt:new Date(now+300_000).toISOString(),
  administrativeChange:false,profileVersion:8,stopVersion:5};
 const payload=JSON.stringify(grant);
 const signature=Buffer.from(await subtle.sign({name:'ECDSA',hash:'SHA-256'},
  pair.privateKey,new TextEncoder().encode(payload))).toString('base64url');
 const args={db,config:{get:async()=>JSON.stringify(
  await subtle.exportKey('jwk',pair.publicKey))},request:input,
  envelope:{payload,signature},
  verifyManifest:async()=>({verified:true,target:input.target,
   sourceSha:input.sourceSha,artifactDigest:input.artifactDigest,manifestFileCount:input.manifestFileCount})};
 for(const request of [
  {...input,artifactDigest:'sha256:'+'c'.repeat(64)},
  {...input,target:'hatchable-v138'},
  {...input,sourceSha:'c'.repeat(40)},
 ]){
  const denied=await submitDeploymentReleaseReceipt({...args,request});
  assert.equal(denied.ok,false);
  assert.equal(denied.reason,'owner-grant-invalid');
 }
 const missingReadback={...input};
 delete missingReadback.independentReadback;
 assert.equal((await submitDeploymentReleaseReceipt({
  ...args,request:missingReadback})).reason,'request-invalid');
 const tamperedPayload=JSON.stringify({...grant,profileVersion:9});
 assert.equal((await submitDeploymentReleaseReceipt({...args,
  envelope:{payload:tamperedPayload,signature}})).reason,'owner-grant-invalid');
 await db.exec('UPDATE brain_owner_autonomy_profile SET version=9 WHERE id=1');
 assert.equal((await submitDeploymentReleaseReceipt(args)).reason,'authority-denied');
 await db.exec('UPDATE brain_owner_autonomy_profile SET version=8 WHERE id=1');
 await db.exec('UPDATE brain_runtime_control SET version=6 WHERE id=1');
 assert.equal((await submitDeploymentReleaseReceipt(args)).reason,'authority-denied');
 await db.exec('UPDATE brain_runtime_control SET version=5,paused=true WHERE id=1');
 assert.equal((await submitDeploymentReleaseReceipt(args)).reason,'authority-denied');
 await db.exec('UPDATE brain_runtime_control SET paused=false WHERE id=1');
 for(const table of ['brain_authority_grants','brain_deployment_release_receipts','brain_events']){
  assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
 }
 const unavailable=await submitDeploymentReleaseReceipt({...args,
  verifyManifest:async()=>({verified:false,reason:'hatchable-manifest-http-401'})});
 assert.equal(unavailable.ok,false);
 assert.equal(unavailable.status,'reconcile-required');
 assert.equal(unavailable.reason,'independent-manifest-readback-not-verified');
 const falseMatch=await submitDeploymentReleaseReceipt({...args,
  verifyManifest:async()=>({verified:true,target:input.target,
   artifactDigest:'sha256:'+'f'.repeat(64),manifestFileCount:input.manifestFileCount})});
 assert.equal(falseMatch.ok,false);
 assert.equal((await db.query('SELECT count(*)::int n FROM brain_deployment_release_receipts')).rows[0].n,0);
 const foreignSource=await submitDeploymentReleaseReceipt({...args,
  verifyManifest:async()=>({verified:true,target:input.target,
   sourceSha:'d'.repeat(40),artifactDigest:input.artifactDigest,
   manifestFileCount:input.manifestFileCount})});
 assert.equal(foreignSource.ok,false);
 assert.equal(foreignSource.reason,'independent-manifest-readback-not-verified');
 assert.equal((await db.query('SELECT count(*)::int n FROM brain_deployment_release_receipts')).rows[0].n,0);
 const first=await submitDeploymentReleaseReceipt(args);
 assert.equal(first.ok,true);assert.equal(first.status,'observed');
 const replay=await submitDeploymentReleaseReceipt(args);
 assert.equal(replay.ok,true);assert.equal(replay.status,'observed');
 assert.equal((await db.query('SELECT count(*)::int n FROM brain_deployment_release_receipts')).rows[0].n,1);
 assert.equal((await db.query(`SELECT count(*)::int n FROM brain_events
  WHERE event_type='deployment-release-receipt-recorded'`)).rows[0].n,1);
});
