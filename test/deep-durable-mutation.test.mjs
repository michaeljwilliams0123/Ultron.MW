import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {executeDurableMutation} from '../src/mutations/durable-executor.mjs';
const G='owner-approved-grant-001',K='ultron-deep-write-001';
const T='github:pr-comment:michaeljwilliams0123/Ultron.MW:427';
async function setup(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY)');
 await db.query('INSERT INTO brain_authority_grants(grant_id) VALUES($1)',[G]);
 await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0045_deep_mutation_and_slots.sql',import.meta.url),'utf8'));
 return db;
}
function job(pgClient,{type='pr.comment',target=T,mutate=async()=>{},
 readback=async()=>({confirmed:true,externalId:'comment-919',hash:'a'.repeat(64)})}={}){
 return{pgClient,idempotencyKey:K,ownerGrantId:G,operationType:type,targetRef:target,
 authorize:async({ownerGrantId,operationType,targetRef})=>({valid:true,grantId:ownerGrantId,operationType,targetRef}),
 policyValidator:async()=>true,githubMutateFn:mutate,githubReadbackFn:readback};
}
test('DURABLE-01 concurrent replay sends one external POST',async t=>{
 const db=await setup(t);let posts=0;
 const req=job(db,{mutate:async()=>{posts++;await new Promise(r=>setTimeout(r,5))}});
 await Promise.all([executeDurableMutation(req),executeDurableMutation(req)]);
 assert.equal(posts,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM brain_github_deep_mutations')).rows[0].n,1);
});
test('DURABLE-02 lost provider ACK reconciles without another write',async t=>{
 const db=await setup(t);let posts=0,confirmed=false;
 const req=job(db,{mutate:async()=>{posts++;confirmed=true;throw Error('lost ACK')},
  readback:async()=>confirmed?({confirmed:true,externalId:'comment-11',hash:'b'.repeat(64)}):({confirmed:false})});
 const a=await executeDurableMutation(req);
 const b=await executeDurableMutation(req);
 assert.equal(a.status,'verified');assert.equal(b.status,'verified');assert.equal(posts,1);
 assert.equal(b.executed,false);
});
test('DURABLE-03 cross-operation grant reuse is rejected',async t=>{
 const db=await setup(t);let posts=0;
 const req=job(db,{mutate:async()=>{posts++}});
 req.authorize=async()=>({valid:true,grantId:G,operationType:'pr.comment',targetRef:T});
 req.operationType='repair.branch.create';
 await assert.rejects(executeDurableMutation(req),/grant-rejected/);
 assert.equal(posts,0);
});
test('DURABLE-04 uncertain writes remain held on retry',async t=>{
 const db=await setup(t);let posts=0;
 const req=job(db,{mutate:async()=>{posts++},readback:async()=>({confirmed:false})});
 assert.equal((await executeDurableMutation(req)).status,'reconcile-required');
 assert.equal((await executeDurableMutation(req)).status,'reconcile-required');
 assert.equal(posts,1);
});
test('DURABLE-05 finalized receipts cannot be deleted',async t=>{
 const db=await setup(t);await executeDurableMutation(job(db));
 await assert.rejects(db.query('DELETE FROM brain_github_deep_mutations WHERE idempotency_key=$1',[K]),/deep-mutation-immutable/);
});
