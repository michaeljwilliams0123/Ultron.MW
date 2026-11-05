import test from 'node:test';
import assert from 'node:assert/strict';
import {
 COUNCIL_APP_ROLES,authenticateCouncilAppActor,issueCouncilExecutionReceipt,
 verifyCouncilExecutionReceipt,summarizeCouncilIdentityEvidence
} from '../src/council-app-identities.mjs';

const repo='michaeljwilliams0123/Ultron.MW';
const sourceSha='a'.repeat(40);
const caseSha='b'.repeat(64);
const probeFor=role=>async()=>({
 source:'github-installations-api',app_id:10,id:20,app_slug:'ultron-mw-'+role.toLowerCase(),
 repositories:[repo],permissions:{metadata:'read',contents:'read',issues:'write',
  pull_requests:'write',checks:'read',actions:'read'}
});
const actorFor=role=>authenticateCouncilAppActor({
 role,sourceSha,installationToken:'x'.repeat(20),githubProbe:probeFor(role)
});
const response=(role,over={})=>({
 source:'github-api-response',url:'https://api.github.com/repos/'+repo+'/issues/comments/5',
 id:5,author_login:'ultron-mw-'+role.toLowerCase()+'[bot]',author_type:'Bot',...over
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
