import test from 'node:test';
import assert from 'node:assert/strict';
import {observeExternalEffect,verifyExternalEffect,verifyAndReportExternalEffect} from '../src/verification/readback_oracle.mjs';
import {canonicalJson} from '../src/verification/canonical_json.mjs';

const gh='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/pulls/42';
const http='https://ultron-mw-cloud.hatchable.site/health';
const githubAssertion={checkType:'github_api_readback',targetEndpointOrSelector:gh,
 expectedValue:'closed',expectedField:'state'};
const httpAssertion={checkType:'http_status',targetEndpointOrSelector:http,expectedValue:200};
const fetcher=async()=>({status:200,ok:true,json:async()=>({state:'closed'})});
const services={fetcher,allowedOrigins:['https://ultron-mw-cloud.hatchable.site']};

test('canonical JSON digest input is stable across object key ordering',()=>{
 assert.equal(canonicalJson({outer:{z:1,a:2},checks:[{reason:'matched',ok:true}]}),
  canonicalJson({checks:[{ok:true,reason:'matched'}],outer:{a:2,z:1}}));
});

test('HTTP status verifies transport only; no durable external completion',async()=>{
 const checked=await observeExternalEffect(httpAssertion,services);
 assert.equal(checked.ok,true);
 assert.equal(checked.tier,'transport-only');
 assert.equal(await verifyExternalEffect(httpAssertion,services),true);
});
test('GitHub API readback accepts only exact repository, field, status, and expected value',async()=>{
 assert.equal((await observeExternalEffect(githubAssertion,services)).tier,'provider-state');
 assert.equal(await verifyExternalEffect(githubAssertion,services),true);
 assert.equal(await verifyExternalEffect({...githubAssertion,expectedValue:'merged'},services),false);
 assert.equal(await verifyExternalEffect({...githubAssertion,expectedField:'__proto__'},services),false);
 assert.equal(await verifyExternalEffect({...githubAssertion,targetEndpointOrSelector:'https://evil.example/repos/michaeljwilliams0123/Ultron.MW/pulls/42'},services),false);
 assert.equal(await verifyExternalEffect({...githubAssertion,targetEndpointOrSelector:'https://api.github.com/repos/other/repo/pulls/42'},services),false);
 assert.equal(await verifyExternalEffect(githubAssertion,{fetcher:async()=>({ok:false,status:401})}),false);
});
test('GitHub readback strips redirects, cache and does not forward secrets to arbitrary origins',async()=>{
 let observed;
 const check=await observeExternalEffect(githubAssertion,{fetcher:async(url,init)=>{
  observed={url,init};return {status:200,ok:true,json:async()=>({state:'closed'})};
 }});
 assert.equal(check.ok,true);
 assert.equal(observed.url,gh);
 assert.equal(observed.init.redirect,'error');
 assert.equal(observed.init.cache,'no-store');
 assert.equal(observed.init.method,'GET');
 assert.equal(observed.init.headers.Authorization,undefined);
});
test('DOM matching is origin-bound, accessibility reader sourced, and never durable proof',async()=>{
 const assertion={checkType:'dom_element_present',targetEndpointOrSelector:'role=button[name="Save"]',
  expectedValue:'present',allowedOrigin:'https://ultron-mw-cloud.hatchable.site'};
 const got=await observeExternalEffect(assertion,{allowedOrigins:['https://ultron-mw-cloud.hatchable.site'],domReadback:async()=>({present:true,
  origin:'https://ultron-mw-cloud.hatchable.site',visible:true})});
 assert.equal(got.ok,true);assert.equal(got.tier,'dom-only');
 assert.equal(await verifyExternalEffect(assertion,{allowedOrigins:['https://ultron-mw-cloud.hatchable.site'],domReadback:async()=>({present:true,
   visible:true,origin:'https://malicious.test'})}),false);
 assert.equal(await verifyExternalEffect(assertion,{allowedOrigins:['https://ultron-mw-cloud.hatchable.site'],domReadback:async()=>({present:true,
   visible:false,origin:'https://ultron-mw-cloud.hatchable.site'})}),false);
});
test('Database readback requires committed record and exact request correlation',async()=>{
 const assertion={checkType:'database_readback',targetEndpointOrSelector:'brain_tasks:task-17',
   expectedValue:'done',expectedField:'status',correlationKey:'task-17'};
 const valid={committed:true,correlationKey:'task-17',status:'done'};
 assert.equal(await verifyExternalEffect(assertion,{databaseReadback:async()=>valid}),true);
 assert.equal(await verifyExternalEffect(assertion,{databaseReadback:async()=>({...valid,correlationKey:'other'})}),false);
 assert.equal(await verifyExternalEffect(assertion,{databaseReadback:async()=>({...valid,committed:false})}),false);
});
test('reporter persists then independently rereads the exact event digest before verified',async()=>{
 const records=new Map();let writes=0;
 const reporter={write:async e=>{writes++;records.set(e.attemptId,e);return {ok:true};},
  read:async id=>records.get(id)};
 const output=await verifyAndReportExternalEffect({attemptId:'attempt-001',
  assertions:[httpAssertion,githubAssertion],services,reporter});
 assert.equal(output.status,'verified-external');
 assert.equal(output.persisted,true);assert.equal(writes,1);
 assert.match(output.evidenceDigest,/^[a-f0-9]{64}$/);
 assert.equal(records.get('attempt-001').evidenceDigest,output.evidenceDigest);
 assert.equal(records.get('attempt-001').checks[1].tier,'provider-state');
 assert.equal(records.get('attempt-001').checks[1].ok,true);
});
test('transport-only result, mismatches, and reported-but-not-retrievable receipt never complete',async()=>{
 const saves=[];const reporter={write:async e=>{saves.push(e);return {ok:true};},read:async()=>saves.at(-1)};
 const transport=await verifyAndReportExternalEffect({attemptId:'attempt-002',assertions:[httpAssertion],services,reporter});
 assert.equal(transport.status,'observed-only');
 const mismatch=await verifyAndReportExternalEffect({attemptId:'attempt-003',
  assertions:[{...githubAssertion,expectedValue:'open'}],services,reporter});
 assert.equal(mismatch.status,'not-verified');
 const stale=await verifyAndReportExternalEffect({attemptId:'attempt-004',
  assertions:[githubAssertion],services,reporter:{...reporter,read:async()=>({...saves.at(-1),evidenceDigest:'f'.repeat(64)})}});
 assert.equal(stale.status,'reconcile-required');assert.equal(stale.persisted,false);
});
test('readback failures report reconcile-required without replaying a write or leaking secrets',async()=>{
 const saved=[];const reporter={write:async e=>{saved.push(e);return {ok:true};},read:async()=>saved.at(-1)};
 const response=await verifyAndReportExternalEffect({attemptId:'attempt-005',assertions:[githubAssertion],
  services:{fetcher:async()=>{throw Error('token is SECRET-DO-NOT-LEAK');}},reporter});
 assert.equal(response.status,'reconcile-required');
 assert.equal(saved.at(-1).status,'reconcile-required');
 assert.equal(JSON.stringify(response).includes('SECRET-DO-NOT-LEAK'),false);
});
test('missing reporter cannot promote an otherwise successful provider readback',async()=>{
 const outcome=await verifyAndReportExternalEffect({attemptId:'attempt-006',assertions:[githubAssertion],services});
 assert.equal(outcome.status,'reconcile-required');assert.equal(outcome.persisted,false);
});
