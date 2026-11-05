import test from 'node:test';
import assert from 'node:assert/strict';
import {
 COUNCIL_APP_ROLES,authenticateCouncilAppActor,issueCouncilExecutionReceipt,
 verifyCouncilExecutionReceipt,summarizeCouncilIdentityEvidence
} from '../src/council-app-identities.mjs';
import {receiptValid as cloudReceiptValid} from '../cloud/hatchable/lib/council-ledger.js';

const repo='michaeljwilliams0123/Ultron.MW';
const sourceSha='a'.repeat(40);
const caseSha='b'.repeat(64);
const probeFor=role=>async()=>({
 source:'github-installations-api',app_id:10,id:20,app_slug:'ultron-mw-'+role.toLowerCase(),
 repositories:[repo],permissions:{metadata:'read',contents:'read',issues:'write',
  pull_requests:'write',checks:'read',actions:'read'}
});
const actorFor=role=>authenticateCouncilAppActor({
 role,sourceSha,installationToken:'x'.repeat(20),expectedAppId:10,githubProbe:probeFor(role)
});
const response=(role,over={})=>({
 source:'github-api-response',url:'https://api.github.com/repos/'+repo+'/issues/comments/5',
 id:5,author_login:'ultron-mw-'+role.toLowerCase()+'[bot]',author_type:'Bot',
 app_id:10,app_slug:'ultron-mw-'+role.toLowerCase(),...over
});
const issue=(actor,over={})=>issueCouncilExecutionReceipt(actor,{
 operation:'issue.comment',caseSha,githubResponse:response(actor.role),
 observedAt:'2026-11-05T18:00:00Z',...over
});

test('receipt requires a branded authenticated actor and bot-authored response',async()=>{
 const actor=await actorFor('Builder');
 assert.throws(()=>issueCouncilExecutionReceipt({...actor},{operation:'issue.comment',caseSha,
  githubResponse:response('Builder'),observedAt:'2026-11-05T18:00:00Z'}),/actor-unverified/);
 for(const bad of [{author_login:'github-actions[bot]'},{author_type:'User'},
  {author_login:'ultron-mw-skeptic[bot]'},{url:'https://api.github.com/repos/other/x/issues/1'},
  {source:'planner-text'}])
  assert.throws(()=>issue(actor,{githubResponse:response('Builder',bad)}),/authorship-unproven/);
 const r=issue(actor);
 assert.equal(verifyCouncilExecutionReceipt(r),true);
 assert.equal(r.claims.independentReview,false);
 assert.equal(r.claims.modelInvoked,false);
});

test('Coordinator receipt is App-ID-bound, cloud-valid, and never an independent review',async()=>{
 const actor=await authenticateCouncilAppActor({role:'Builder',sourceSha,
  installationToken:'x'.repeat(20),expectedAppId:5633654,
  githubProbe:async()=>({source:'github-installations-api',app_id:5633654,id:77,
   app_slug:'ultron-mw-builder-v2',repositories:[repo],permissions:{metadata:'read',
    contents:'read',issues:'write',pull_requests:'write',checks:'read',actions:'read'}})});
 const receipt=issueCouncilExecutionReceipt(actor,{operation:'issue.comment',caseSha,
  observedAt:'2026-11-05T18:00:00Z',githubResponse:{source:'github-api-response',
   url:'https://api.github.com/repos/'+repo+'/issues/comments/5',id:5,
   author_login:'ultron-mw-builder-v2[bot]',author_type:'Bot',
   app_id:5633654,app_slug:'ultron-mw-builder-v2'}});
 assert.equal(receipt.app.kind,'coordinator');
 assert.equal(receipt.claims.independentReview,false);
 assert.equal(verifyCouncilExecutionReceipt(receipt),true);
 assert.equal(cloudReceiptValid(receipt),true);
 assert.equal(verifyCouncilExecutionReceipt({...receipt,app:{...receipt.app,slug:'ultron-mw-builder'}}),false);
});

test('tampered or forged receipts fail verification',async()=>{
 const r=issue(await actorFor('Skeptic'));
 assert.equal(verifyCouncilExecutionReceipt({...r,operation:'review.approve'}),false);
 assert.equal(verifyCouncilExecutionReceipt({...r,role:'Builder'}),false);
 assert.equal(verifyCouncilExecutionReceipt({...r,claims:{...r.claims,independentReview:true}}),false);
 assert.equal(verifyCouncilExecutionReceipt(null),false);
});

test('identity evidence counts only distinct roles for the exact case and source',async()=>{
 const receipts=[];
 for(const role of COUNCIL_APP_ROLES.slice(0,3))receipts.push(issue(await actorFor(role)));
 receipts.push(receipts[0]);
 let s=summarizeCouncilIdentityEvidence(receipts,{caseSha,sourceSha});
 assert.equal(s.rolesProven,3);
 assert.equal(s.acceptanceMet,false);
 assert.deepEqual(s.missing,COUNCIL_APP_ROLES.slice(3));
 assert.equal(summarizeCouncilIdentityEvidence(receipts,{caseSha:'c'.repeat(64),sourceSha}).rolesProven,0);
 for(const role of COUNCIL_APP_ROLES.slice(3))receipts.push(issue(await actorFor(role)));
 s=summarizeCouncilIdentityEvidence(receipts,{caseSha,sourceSha});
 assert.equal(s.acceptanceMet,true);
});
