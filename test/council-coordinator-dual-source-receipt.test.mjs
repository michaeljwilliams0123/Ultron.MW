import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticateCouncilAppActor,verifyCouncilExecutionReceipt}
 from '../src/council-app-identities.mjs';
import {receiptValid as cloudReceiptValid}
 from '../cloud/hatchable/lib/council-ledger.js';
import {probeCouncilEffect} from '../src/council-members.mjs';

const SHA='a'.repeat(40),KEY='e'.repeat(64),CASE='b'.repeat(64);
const REPO='michaeljwilliams0123/Ultron.MW',PR=484,REVIEW=5944624969;
const MARKER='<!-- council-exec:'+KEY+' -->';
async function actor(){
 return authenticateCouncilAppActor({role:'Skeptic',sourceSha:SHA,
  expectedAppId:5633654,installationToken:'tested-installation-token',
  profile:'engineering-autonomy',
  githubProbe:async()=>({
   source:'github-installations-api',app_id:5633654,id:179066535,
   app_slug:'ultron-coordinator',suspended_at:null,repositories:[REPO],
   permissions:{metadata:'read',contents:'read',issues:'write',
    pull_requests:'write',checks:'read',actions:'read'}
  })
 });
}
const review=(changes={})=>({
 id:REVIEW,body:'Falsifiable regression finding.\n'+MARKER,
 user:{id:353078104,login:'ultron-coordinator[bot]',type:'Bot'},
 state:'COMMENTED',commit_id:SHA,...changes
});
async function probe(a,items){
 const calls=[];
 const fetchImpl=async(url,options={})=>{
  calls.push({url,method:options.method});
  return {ok:true,status:200,json:async()=>items};
 };
 const result=await probeCouncilEffect(a,'installation-token',{
  op:'review.comment',number:PR,executionKey:KEY,caseSha:CASE
 },fetchImpl);
 return {result,calls};
}
test('real GitHub PR review missing performed_via_github_app still creates explicitly dual-source attested receipt',async()=>{
 const a=await actor();
 const {result,calls}=await probe(a,[review()]);
 assert.ok(result?.receipt,'matched authenticated bot review should produce receipt');
 assert.equal(result.receipt.effect.author,a.botLogin);
 assert.equal(result.receipt.effect.url,
  'https://api.github.com/repos/'+REPO+'/pulls/'+PR+'/reviews/'+REVIEW);
 assert.equal(result.receipt.sourceSha,SHA);
 assert.equal(result.receipt.app.id,5633654);
 assert.equal(result.receipt.claims.authorshipFromGithubResponse,false,
  'must never claim GitHub returned missing App attribution');
 assert.equal(result.receipt.claims.appIdentityFromAuthenticatedInstallation,true);
 assert.equal(result.receipt.claims.botReviewCommitReadbackVerified,true);
 assert.equal(result.receipt.claims.independentReview,false);
 assert.equal(verifyCouncilExecutionReceipt(result.receipt),true);
 assert.equal(cloudReceiptValid(result.receipt),true);
 assert.ok(calls.every(c=>c.method==='GET'),'probe must never re-POST an external effect');
});
test('dual-source receipt is denied when review commit or bot identity differ',async()=>{
 const a=await actor();
 for(const bad of [
  {commit_id:'c'.repeat(40)},
  {commit_id:null},
  {state:'APPROVED'},
  {state:'PENDING'},
  {user:{id:353078104,login:'github-actions[bot]',type:'Bot'}},
  {user:{id:353078104,login:a.botLogin,type:'User'}},
  {user:{id:0,login:a.botLogin,type:'Bot'}},
  {id:'5944624969'},
  {id:0}
 ]){
  const {result}=await probe(a,[review(bad)]);
  assert.equal(result?.receipt,undefined,JSON.stringify(bad));
 }
});
test('mismatched supplied GitHub App attribution must fail, never silently downgrade to dual-source',async()=>{
 const a=await actor();
 for(const bad of [
  {performed_via_github_app:{id:8,slug:'other-app'}},
  {performed_via_github_app:{id:5633654,slug:'wrong-app'}}
 ]){
  const {result}=await probe(a,[review(bad)]);
  assert.equal(result?.receipt,undefined);
 }
});
test('missing or duplicated exact execution markers never authorize new receipt',async()=>{
 const a=await actor();
 for(const body of [
  'No owner execution marker',
  MARKER+'\n'+MARKER,
  '<!-- council-exec:'+('f'.repeat(64))+' -->'
 ]){
  const {result}=await probe(a,[review({body})]);
  assert.equal(result?.receipt,undefined);
 }
});
test('dual-source receipt claims, effect URL, source SHA, digest, and identity cannot be tampered',async()=>{
 const a=await actor();
 const {result}=await probe(a,[review()]);
 const r=result?.receipt;
 assert.ok(r);
 for(const change of [
  {claims:{...r.claims,authorshipFromGithubResponse:true}},
  {claims:{...r.claims,independentReview:true}},
  {claims:{...r.claims,botReviewCommitReadbackVerified:false}},
  {effect:{...r.effect,url:'https://api.github.com/repos/other/repo/pulls/484/reviews/'+REVIEW}},
  {sourceSha:'c'.repeat(40)},
  {app:{...r.app,id:999}},
  {digest:'0'.repeat(64)}
 ]){
  assert.equal(verifyCouncilExecutionReceipt({...r,...change}),false);
  assert.equal(cloudReceiptValid({...r,...change}),false);
 }
});

async function paginatedProbe(a,pages){
 const calls=[];
 const fetchImpl=async(url,options={})=>{
  calls.push({url,method:options.method});
  const idx=Number(new URL(url).searchParams.get('page'))-1;
  return {ok:true,status:200,json:async()=>pages[idx]||[]};
 };
 const result=await probeCouncilEffect(a,'installation-token',{
  op:'review.comment',number:PR,executionKey:KEY,caseSha:CASE
 },fetchImpl);
 return {result,calls};
}
test('multiple matching reviews on one page are ambiguous and cannot become verified',async()=>{
 const a=await actor();
 const {result}=await paginatedProbe(a,[[review({id:11}),review({id:12})]]);
 assert.equal(result?.receipt,undefined);
});
test('duplicate matching reviews across pages are ambiguous, not first-match success',async()=>{
 const a=await actor();
 const first=Array.from({length:100},(_,i)=>review({id:i+1,body:'other review'}));
 first[88]=review({id:950});
 const {result,calls}=await paginatedProbe(a,[first,[review({id:951})]]);
 assert.equal(result?.receipt,undefined);
 assert.equal(calls.length,2,'scan all pages before establishing uniqueness');
});
test('one matching review on a later page is recoverable only after complete scan',async()=>{
 const a=await actor();
 const first=Array.from({length:100},(_,i)=>review({id:i+1,body:'old review'}));
 const {result,calls}=await paginatedProbe(a,[first,[review({id:999})]]);
 assert.equal(result?.receipt?.effect?.id,999);
 assert.equal(cloudReceiptValid(result?.receipt),true);
 assert.equal(calls.length,2);
});
test('ten full pages mean readback is incomplete and no receipt is authorized',async()=>{
 const a=await actor();
 const pages=Array.from({length:10},(_,p)=>Array.from({length:100},(_,i)=>
  review({id:p*100+i+1,body:p===0&&i===8?MARKER:'historical review'})));
 const {result,calls}=await paginatedProbe(a,pages);
 assert.equal(result?.receipt,undefined);
 assert.equal(calls.length,10);
});
