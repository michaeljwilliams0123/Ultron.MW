import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createComposioPostgresStore} from '../postgres-store.mjs';

const migration=new URL('../../../cloud/hatchable/migrations/0046_composio_sessions.sql',import.meta.url);
const ids={primaryAccountId:'ca_primary_worker_123',executorAccountId:'ca_admin_worker_456'};
const config='ac_custom_verified_123';
const hash='a'.repeat(64),sha='b'.repeat(40);
async function fixture(){
 const db=new PGlite();await db.exec(await readFile(migration,'utf8'));
 await db.query("UPDATE brain_composio_principals SET connected_account_id=$1,custom_auth_config_id=$2,connection_state='active' WHERE principal_key='mw-primary'",[ids.primaryAccountId,config]);
 await db.query("UPDATE brain_composio_principals SET connected_account_id=$1,custom_auth_config_id=$2,connection_state='active',grant_digest=$3 WHERE principal_key='ultron-admin'",[ids.executorAccountId,config,hash]);
 return {db,store:createComposioPostgresStore({db,accountIds:ids,customAuthConfigId:config})};
}
test('reserve, activate, read and independently confirm a minimal receipt',async()=>{
 const {db,store}=await fixture();
 try{
  const lease=await store.reserve({profile:'primary-direct',userId:'ultron-owner-308995719',sourceSha:sha,configDigest:hash});
  assert.equal(lease.ok,true);
  await store.activate({profile:'primary-direct',sessionId:'session_test_123',configDigest:hash,sourceSha:sha,lease:lease.id});
  const stored=await store.read('primary-direct');
  assert.equal(stored.status,'active');
  assert.equal(stored.sessionId,'session_test_123');
  const receipt=await store.recordObservation({sessionId:'session_test_123',actor:'mw-primary',
   sourceSha:sha,githubUserId:308995719,repositoryId:1424939667,observationDigest:hash});
  assert.equal(receipt.verified,true);
  const {rows}=await db.query('SELECT operation,result FROM brain_composio_read_receipts WHERE receipt_key=$1',[receipt.receiptKey]);
  assert.equal(rows[0].result,'verified');
  assert.equal(rows[0].operation,'GITHUB_GET_A_REPOSITORY');
  await assert.rejects(store.reserve({profile:'primary-direct',userId:'ultron-owner-308995719',sourceSha:sha,configDigest:hash}),/existing active/);
 }finally{await db.close();}
});
test('unverified principal cannot reserve and an uncertain create stays blocked',async()=>{
 const {db,store}=await fixture();
 try{
  await db.query("UPDATE brain_composio_principals SET connection_state='revoked' WHERE principal_key='ultron-admin'");
  await assert.rejects(store.reserve({profile:'multi-account',userId:'ultron-owner-308995719',sourceSha:sha,configDigest:hash}),/not independently verified/);
  const lease=await store.reserve({profile:'primary-direct',userId:'ultron-owner-308995719',sourceSha:sha,configDigest:hash});
  assert.equal((await store.reconcile({profile:'primary-direct',lease:lease.id})).reconcileRequired,true);
  assert.equal((await store.read('primary-direct')).status,'reconcile-required');
  await assert.rejects(store.reserve({profile:'primary-direct',userId:'ultron-owner-308995719',sourceSha:sha,configDigest:hash}),/existing active or unsettled/);
 }finally{await db.close();}
});
test('receipt rejects wrong actor identity and no credential bytes are persisted',async()=>{
 const {db,store}=await fixture();
 try{
  await assert.rejects(store.recordObservation({sessionId:'none',actor:'ultron-admin',sourceSha:sha,
   githubUserId:308995719,repositoryId:1424939667,observationDigest:hash}),/invalid receipt identity/);
  const {rows}=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='brain_composio_principals'");
  assert.equal(rows.some(x=>/token|private_key|secret/.test(x.column_name)),false);
 }finally{await db.close();}
});
