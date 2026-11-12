// Regression tests for the Skeptic review of PR #416 (M1, L1, L2, L3 and the
// terminal-state additions). Each R* case failed at d72e884 and passes now.
// Offline only: PGlite + the stateful GitHub double from the shared fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adjudicator,canary,database,sign,github,counts,publicJwk,APP,SOURCE}
 from './helpers/github-branch-canary-fixture.mjs';

async function prepared(t,options){
 const db=await database(t,options);
 return {db,...await canary.prepareBranchCanary({db,sourceSha:SOURCE})};
}
const run=(h,envelope,fetchImpl)=>canary.runBranchCanary({db:h.db,prepared:h.prepared,
 envelope,publicJwk,appCredentials:APP,fetchImpl});
const services=(h,fetchImpl,grantId)=>({db:h.db,prepared:h.prepared,grantId,
 appCredentials:APP,fetchImpl});
const ledger=db=>db.query(`SELECT state,grant_id,receipt FROM github_idempotent_executions`)
 .then(r=>r.rows);
const events=(db,type)=>db.query(`SELECT details FROM brain_events WHERE event_type=$1`,[type])
 .then(r=>r.rows);
const repoWrites=gh=>gh.posts('/git/commits')+gh.posts('/git/refs');
const intercept=(gh,hook)=>async(url,options={})=>{
 await hook(url,(options.method||'GET').toUpperCase());
 return gh.fetchImpl(url,options);
};

// ---- L1 -----------------------------------------------------------------
async function loadAuthorityRoute(db){
 const raw=await readFile(new URL('../cloud/hatchable/api/brain/authority.js',import.meta.url),'utf8');
 const b64=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 globalThis.__authority412={db,jwk:JSON.stringify(publicJwk)};
 const platform=b64(`export const db=globalThis.__authority412.db;
export const config={get:async()=>globalThis.__authority412.jwk};`);
 const adjudicatorUrl=new URL('../cloud/hatchable/lib/security-adjudicator.js',import.meta.url).href;
 const source=raw.replace("from 'hatchable'","from '"+platform+"'")
  .replace("from 'lib/security-adjudicator.js'","from '"+adjudicatorUrl+"'");
 assert.notEqual(source,raw);
 return import(b64(source)+'#'+Math.random());
}
const reply=()=>({code:200,status(n){this.code=n;return this;},json(body){return {status:this.code,body};}});

test('L1/R1 /api/brain/authority refuses repair.branch.create; the grant stays unburned for the canary',async t=>{
 const h=await prepared(t),gh=github(),envelope=await sign(h.ownerGrantRequest);
 const route=await loadAuthorityRoute(h.db);
 t.after(()=>{delete globalThis.__authority412;});
 const r=await route.default({body:{envelope,request:canary.branchGrantRequest(h.prepared)}},reply());
 assert.deepEqual([r.status,r.body.error],[403,'operation-requires-dedicated-route']);
 assert.deepEqual(await counts(h.db),{nonces:0,grants:0,executions:0});
 const result=await run(h,envelope,gh.fetchImpl);
 assert.deepEqual([result.http,result.status],[201,'success']);
});

test('L1 the authority route also refuses pr.comment, and refuses by the verified operation',async t=>{
 const db=await database(t);
 const route=await loadAuthorityRoute(db);
 t.after(()=>{delete globalThis.__authority412;});
 const r=await route.default({body:{envelope:{payload:'{}',signature:'x'},
  request:{operation:'pr.comment'}}},reply());
 assert.deepEqual([r.status,r.body.error],[403,'operation-requires-dedicated-route']);
 const source=await readFile(new URL('../cloud/hatchable/api/brain/authority.js',import.meta.url),'utf8');
 assert.match(source,/DEDICATED\.has\(verified\?\.operation\)/);
});

test('L1/R1 consumeDelegatedGrant refuses a verified branch grant without writing',async t=>{
 const h=await prepared(t);
 const verified=await adjudicator.verifyDelegatedGrant({envelope:await sign(h.ownerGrantRequest),
  publicJwk,request:canary.branchGrantRequest(h.prepared)});
 assert.deepEqual(await adjudicator.consumeDelegatedGrant({db:h.db,verifiedGrant:verified}),
  {ok:false,error:'operation-requires-dedicated-reservation'});
 assert.deepEqual(await counts(h.db),{nonces:0,grants:0,executions:0});
});

// ---- L2 -----------------------------------------------------------------
test('L2/R2 a branch grant signed under any other policySha is refused before reservation',async t=>{
 const h=await prepared(t),gh=github();
 assert.equal(h.ownerGrantRequest.policySha,adjudicator.BRANCH_POLICY_SHA);
 const envelope=await sign({...h.ownerGrantRequest,policySha:'f'.repeat(64)});
 await assert.rejects(adjudicator.verifyDelegatedGrant({envelope,publicJwk,
  request:canary.branchGrantRequest(h.prepared)}),/invalid-grant-branch-policy/);
 const result=await run(h,envelope,gh.fetchImpl);
 assert.deepEqual([result.http,result.error],[403,'authority-not-verified']);
 assert.deepEqual(await counts(h.db),{nonces:0,grants:0,executions:0});
 assert.equal(gh.calls.length,0);
});

// ---- M1 -----------------------------------------------------------------
test('M1/R4 pause between the provider GETs and the first POST: no write, row held, no retry',async t=>{
 const h=await prepared(t),gh=github();
 let flipped=false;
 const fetchImpl=intercept(gh,async(url,method)=>{
  if(!flipped&&method==='GET'&&url.includes('/git/commits/')){
   flipped=true;
   await h.db.query('UPDATE brain_runtime_control SET paused=true,version=version+1 WHERE id=1');
  }
 });
 const result=await run(h,await sign(h.ownerGrantRequest),fetchImpl);
 assert.equal(flipped,true);
 assert.deepEqual([result.http,result.status,result.error],
  [202,'reconcile-required','write-authorization-revoked']);
 assert.equal(repoWrites(gh),0);
 assert.equal((await ledger(h.db))[0].state,'reconcile_required');
});

test('M1 stop version bump between the commit POST and the ref POST: ref never sent, row held',async t=>{
 const h=await prepared(t),gh=github();
 const fetchImpl=intercept(gh,async(url,method)=>{
  if(method==='POST'&&url.endsWith('/git/commits'))
   await h.db.query('UPDATE brain_runtime_control SET version=version+1 WHERE id=1');
 });
 const result=await run(h,await sign(h.ownerGrantRequest),fetchImpl);
 assert.deepEqual([result.http,result.status,result.error],
  [202,'reconcile-required','write-authorization-revoked']);
 assert.equal(gh.posts('/git/commits'),1);
 assert.equal(gh.posts('/git/refs'),0);
 const [stored]=await ledger(h.db);
 assert.equal(stored.state,'reconcile_required');
 // Orphan commit only: reconcile sees no branch and stays unresolved...
 await assert.rejects(canary.reconcileBranchCanary(services(h,gh.fetchImpl,stored.grant_id)),
  /readback-not-found/);
 // ...until the owner abandons it after a fresh absent readback.
 const abandoned=await canary.abandonBranchCanary(services(h,gh.fetchImpl,stored.grant_id));
 assert.deepEqual([abandoned.status,abandoned.previousState],['abandoned','reconcile_required']);
 assert.equal((await ledger(h.db))[0].state,'abandoned');
 assert.equal((await events(h.db,'github-branch-canary-abandoned')).length,1);
 assert.equal(repoWrites(gh),1,'abandon never writes to GitHub');
});

test('M1 the provider write guard refuses an un-armed non-GET before it reaches fetch',async()=>{
 const seen=[];
 const guard=canary.createProviderWriteGuard(async(url,o)=>{seen.push(o?.method||'GET');return {ok:true};});
 await guard.fetch('https://api.github.com/x');
 await assert.rejects(guard.fetch('https://api.github.com/x',{method:'POST'}),/write-guard-unarmed/);
 assert.deepEqual(seen,['GET']);
 assert.deepEqual([guard.status.nonGetSent,guard.status.blocked],[0,true]);
 guard.arm(async()=>{throw Error('denied');});
 await assert.rejects(guard.fetch('https://api.github.com/x',{method:'PATCH'}),/denied/);
 assert.deepEqual(seen,['GET']);
});

// ---- L3 + terminal state ------------------------------------------------
test('L3/R3 main moves after reservation: proven no-write is terminal failed_before_write',async t=>{
 const h=await prepared(t),gh=github();
 const fetchImpl=async(url,o={})=>(o.method||'GET')==='GET'&&url.endsWith('/git/ref/heads/main')
  ?{status:200,ok:true,json:async()=>({ref:'refs/heads/main',object:{type:'commit',sha:'3'.repeat(40)}})}
  :gh.fetchImpl(url,o);
 const envelope=await sign(h.ownerGrantRequest);
 const result=await run(h,envelope,fetchImpl);
 assert.deepEqual([result.http,result.status,result.error],
  [409,'failed_before_write','failed-before-write']);
 assert.equal(repoWrites(gh),0);
 const [stored]=await ledger(h.db);
 assert.deepEqual([stored.state,stored.receipt],['failed_before_write',null]);
 const [event]=await events(h.db,'github-branch-canary-failed-before-write');
 assert.deepEqual([event.details.reason,event.details.nonGetRequestsSent],['source-head-changed',0]);
 const reconciled=await canary.reconcileBranchCanary(services(h,gh.fetchImpl,stored.grant_id));
 assert.deepEqual(reconciled,{status:'failed_before_write',terminal:true});
 const replay=await run(h,envelope,gh.fetchImpl);
 assert.equal(replay.http,409);
 await assert.rejects(canary.abandonBranchCanary(services(h,gh.fetchImpl,stored.grant_id)),
  /abandon-state-failed-before-write/);
});

test('L3 a failure after a POST was attempted is never classified as not-written',async t=>{
 const h=await prepared(t),gh=github({loseCommitAck:true});
 const result=await run(h,await sign(h.ownerGrantRequest),gh.fetchImpl);
 assert.deepEqual([result.http,result.status],[202,'reconcile-required']);
 assert.equal((await ledger(h.db))[0].state,'reconcile_required');
 assert.equal((await events(h.db,'github-branch-canary-failed-before-write')).length,0);
});

test('abandon refuses while the branch exists; reconcile then completes the row',async t=>{
 const h=await prepared(t),gh=github({loseRefAck:true});
 const result=await run(h,await sign(h.ownerGrantRequest),gh.fetchImpl);
 assert.equal(result.status,'reconcile-required');
 const [stored]=await ledger(h.db);
 await assert.rejects(canary.abandonBranchCanary(services(h,gh.fetchImpl,stored.grant_id)),
  /abandon-branch-present/);
 assert.equal((await ledger(h.db))[0].state,'reconcile_required');
 const reconciled=await canary.reconcileBranchCanary(services(h,gh.fetchImpl,stored.grant_id));
 assert.equal(reconciled.status,'reconciled_success');
 await assert.rejects(canary.abandonBranchCanary(services(h,gh.fetchImpl,stored.grant_id)),
  /abandon-state-completed/);
});

test('0044 ledger guard: terminal states are branch-only, reachable only from reserved/reconcile_required, immutable',async t=>{
 const h=await prepared(t),gh=github({loseRefAck:true});
 // A held row (reconcile_required) may not go to failed_before_write.
 await run(h,await sign(h.ownerGrantRequest),gh.fetchImpl);
 await assert.rejects(h.db.query(`UPDATE github_idempotent_executions SET state='failed_before_write'`),
  /transition-denied/);
 await h.db.query(`UPDATE github_idempotent_executions SET state='abandoned'`);
 for(const state of ['completed','reconcile_required','reserved','in_flight'])
  await assert.rejects(h.db.query(`UPDATE github_idempotent_executions SET state=$1`,[state]),
   /terminal-immutable/);
 await assert.rejects(h.db.query(`DELETE FROM github_idempotent_executions`),/immutable/);
 const migration=await readFile(new URL('../cloud/hatchable/migrations/0044_github_branch_grant_executions.sql',import.meta.url),'utf8');
 assert.match(migration,/OLD\.state='in_flight' AND NEW\.state NOT IN \('completed','reconcile_required'\)/);
 assert.match(migration,/grant_id IS NOT NULL AND receipt IS NULL/);
});
