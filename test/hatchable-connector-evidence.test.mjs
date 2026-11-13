import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {verifiedProviderMutations} from '../cloud/hatchable/lib/connector-evidence.js';

async function fixture(t){
 const db=new PGlite();
 await db.exec(`CREATE TABLE brain_mcp_provider_writes (
  action_key text PRIMARY KEY,grant_id text NOT NULL,operation text NOT NULL,
  status text NOT NULL,evidence jsonb,updated_at timestamptz DEFAULT now()
 );
 CREATE TABLE brain_events (
  id bigserial PRIMARY KEY,event_type text NOT NULL,details jsonb NOT NULL
 );`);
 t.after(()=>db.close());
 return db;
}
const KEY='owner-64841784-d5f1-4921-b2dd-75822c74cbea';
const GRANT='passkey-f6c1fc23-b04d-4532-a182-c10983d13820';
const valid={projectId:87884831,branchName:'ultron/task-'+KEY,
 sourceSha:'9e6a18870303b2d75926feb7c93f5cc610ff69e3',
 providerAcknowledged:true,readbackMatches:true};
async function insert(db,{operation='gitlab.branch.create',status='observed',
 evidence=valid,eventEvidence=evidence,eventGrant=GRANT,withEvent=true}={}){
 await db.query(`INSERT INTO brain_mcp_provider_writes(action_key,grant_id,operation,status,evidence)
 VALUES($1,$2,$3,$4,$5::jsonb)`,[KEY,GRANT,operation,status,JSON.stringify(evidence)]);
 if(withEvent)await db.query(`INSERT INTO brain_events(event_type,details)
 VALUES('mcp-provider-write-observed',$1::jsonb)`,[JSON.stringify({
 action_key:KEY,grant_id:eventGrant,operation,evidence:eventEvidence})]);
}
test('real observed branch with a matching immutable event projects as verified',async t=>{
 const db=await fixture(t);
 assert.deepEqual(await verifiedProviderMutations({db}),{gitlabBranchVerified:false});
 await insert(db);
 assert.deepEqual(await verifiedProviderMutations({db}),{gitlabBranchVerified:true});
});
test('unresolved, wrong provider, missing event and fabricated evidence never qualify',async t=>{
 const cases=[
  {status:'reconcile-required'}, {operation:'github.issue.write'},
  {withEvent:false},{eventGrant:'other-grant'},
  {eventEvidence:{...valid,projectId:1}},
  {evidence:{...valid,providerAcknowledged:false}},
  {evidence:{...valid,readbackMatches:false}},
  {evidence:{...valid,projectId:1}},
  {evidence:{...valid,sourceSha:'x'.repeat(40)}},
  {evidence:{...valid,branchName:'ultron/task-unrelated'}},
  {evidence:{...valid,providerAcknowledged:'true'}}
 ];
 for(const one of cases){
  const db=await fixture(t);await insert(db,one);
  assert.deepEqual(await verifiedProviderMutations({db}),{gitlabBranchVerified:false},
   JSON.stringify(one));
 }
});
test('missing or inaccessible ledger fails closed and never discloses errors',async()=>{
 assert.deepEqual(await verifiedProviderMutations({}),{gitlabBranchVerified:false});
 assert.deepEqual(await verifiedProviderMutations({db:{query:async()=>{throw Error('secret db password')}}}),
  {gitlabBranchVerified:false});
});
test('connectors endpoint uses durable evidence rather than hardcoded false',async()=>{
 const source=await readFile(new URL('../cloud/hatchable/api/brain/connectors.js',import.meta.url),'utf8');
 assert.match(source,/verifiedProviderMutations/);
 assert.match(source,/writeMutationVerified:verified[.]gitlabBranchVerified/);
 assert.doesNotMatch(source,/writeMutationVerified:false/);
});
