import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticateCouncilAppActor,issueCouncilExecutionReceipt} from '../src/council-app-identities.mjs';
import {
 executionKey,recordIntent,advance,recordUnattributedEffect,recoverRecord,summarizeLedger
} from '../src/council-execution-ledger.mjs';

const repo='michaeljwilliams0123/Ultron.MW';
const sourceSha='a'.repeat(40),caseSha='b'.repeat(64);
const actor=role=>authenticateCouncilAppActor({role,sourceSha,installationToken:'x'.repeat(20),
 expectedAppId:1,
 githubProbe:async()=>({source:'github-installations-api',app_id:1,id:2,app_slug:'ultron-mw-'+role.toLowerCase(),
  repositories:[repo],permissions:{metadata:'read',contents:'read',issues:'write',pull_requests:'write',checks:'read',actions:'read'}})});
const receiptFor=async(role,operation='issue.comment')=>issueCouncilExecutionReceipt(await actor(role),{
 operation,caseSha,observedAt:'2026-11-05T18:00:00Z',githubResponse:{source:'github-api-response',
  url:'https://api.github.com/repos/'+repo+'/issues/comments/1',id:1,
   author_login:'ultron-mw-'+role.toLowerCase()+'[bot]',author_type:'Bot',
   app_id:1,app_slug:'ultron-mw-'+role.toLowerCase()}});
const intent=(role='Builder',operation='issue.comment')=>recordIntent({role,operation,caseSha,sourceSha});

test('execution key is deterministic and rejects malformed input',()=>{
 const a=executionKey({role:'Builder',operation:'issue.comment',caseSha,sourceSha});
 assert.equal(a,executionKey({role:'Builder',operation:'issue.comment',caseSha,sourceSha}));
 assert.notEqual(a,executionKey({role:'Skeptic',operation:'issue.comment',caseSha,sourceSha}));
 assert.notEqual(a,executionKey({role:'Builder',operation:'issue.comment',caseSha,sourceSha,ordinal:1}));
 assert.throws(()=>executionKey({role:'Nobody',operation:'x',caseSha,sourceSha}),/key-invalid/);
 assert.throws(()=>executionKey({role:'Builder',operation:'x',caseSha:'zz',sourceSha}),/key-invalid/);
});

test('happy path reaches verified only with a matching verified receipt',async()=>{
 let r=advance(advance(intent(),'reserved'),'dispatched');
 assert.throws(()=>advance(r,'verified',{}),/receipt-mismatch/);
 assert.throws(()=>advance(r,'verified',{receipt:null}),/receipt-mismatch/);
 const skeptic=await receiptFor('Skeptic'),close=await receiptFor('Builder','issue.close');
 assert.throws(()=>advance(r,'verified',{receipt:skeptic}),/receipt-mismatch/);
 assert.throws(()=>advance(r,'verified',{receipt:close}),/receipt-mismatch/);
 r=advance(r,'verified',{receipt:await receiptFor('Builder')});
 assert.equal(r.state,'verified');
 assert.equal(r.executor,'ultron-mw-builder[bot]');
 assert.deepEqual(r.history,['intent','reserved','dispatched','verified']);
});

test('illegal and post-terminal transitions are rejected',()=>{
 const r=intent();
 assert.throws(()=>advance(r,'verified',{}),/transition-invalid/);
 assert.throws(()=>advance(r,'dispatched'),/transition-invalid/);
 const failed=advance(r,'failed',{reason:'x'});
 assert.throws(()=>advance(failed,'reserved'),/transition-invalid/);
 assert.throws(()=>advance(r,'bogus'),/transition-invalid/);
});

test('plan-only external operations terminate as planned, never completed',()=>{
 for(const op of ['web.open','mahoraga.repo.inspect','mahoraga.task.prepare']){
  const r=intent('Sentinel',op);
  assert.equal(r.state,'planned');
  assert.throws(()=>advance(r,'reserved'),/transition-invalid/);
 }
});

test('crash recovery never assumes success',()=>{
 const dispatched=advance(advance(intent(),'reserved'),'dispatched');
 const unknown=recoverRecord(dispatched,{providerHasEffect:false});
 assert.equal(unknown.state,'reconcile-required');
 assert.equal(unknown.reason,'outcome-unknown');
 assert.equal(recoverRecord(dispatched,{providerHasEffect:true}).reason,'effect-found-unverified');
 assert.equal(recoverRecord(intent(),{providerHasEffect:true}).state,'failed');
 assert.equal(recoverRecord(unknown,{providerHasEffect:true}),unknown);
});

test('effects by github-actions are recorded truthfully, not as independent',()=>{
 const r=recordUnattributedEffect(intent(),{executor:'github-actions[bot]',url:'https://api.github.com/x'});
 assert.equal(r.state,'reconcile-required');
 assert.equal(r.executor,'github-actions[bot]');
 assert.equal(summarizeLedger([r]).independentlyVerified,0);
});

test('ledger summary separates App-authenticated effects from independent review',async()=>{
 const ok=advance(advance(advance(intent(),'reserved'),'dispatched'),'verified',{receipt:await receiptFor('Builder')});
 const s=summarizeLedger([ok,intent('Sentinel','web.open'),recordUnattributedEffect(intent('Skeptic'),{executor:'github-actions[bot]'})]);
 assert.equal(s.total,3);
 assert.equal(s.appAuthenticatedVerified,1);
 assert.equal(s.independentlyVerified,0);
 assert.equal(s.byState.planned,1);
 assert.equal(s.openReconciliations,1);
});

test('migration enforces uniqueness, closed states and verified-needs-receipt',()=>{
 const sql=readFileSync(new URL('../cloud/hatchable/migrations/0028_council_execution_ledger.sql',import.meta.url),'utf8');
 assert.match(sql,/execution_key TEXT NOT NULL UNIQUE/);
 assert.match(sql,/state<>'verified' OR \(receipt IS NOT NULL AND receipt_digest IS NOT NULL/);
 for(const s of ['reserved','dispatched','verified','executed','failed','reconcile-required','planned'])
  assert.ok(sql.includes("'"+s+"'"),s);
 assert.doesNotMatch(sql,/DROP\s+(TABLE|COLUMN)|TRUNCATE|GRANT/i);
});
