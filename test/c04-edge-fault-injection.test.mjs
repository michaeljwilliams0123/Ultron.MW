import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../cloud/hatchable/lib/github-pr-comment-canary.js',import.meta.url),'utf8')
 .replace("'lib/rsa-pkcs1-sign.js'",JSON.stringify(new URL('../cloud/hatchable/lib/rsa-pkcs1-sign.js',import.meta.url).href));
const {canonicalCanaryComment,reconcilePrCommentCanary}=await import(
 'data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const NUMBER=479,KEY='ultron-task-c04-pr479-'+'a'.repeat(24),DIGEST='b'.repeat(64);
const COMMENT_URL='https://github.com/michaeljwilliams0123/Ultron.MW/pull/479#issuecomment-12345';
function prepared(){
 const commentBody=canonicalCanaryComment({pullRequest:NUMBER,idempotencyKey:KEY});
 return {pullRequest:NUMBER,idempotencyKey:KEY,commentBody,
  bodySha256:createHash('sha256').update(commentBody).digest('hex')};
}
function validReceipt(p=prepared(),digest=DIGEST){
 return {idempotencyKey:p.idempotencyKey,status:'success',details:{
  repository:'michaeljwilliams0123/Ultron.MW',operationDigest:digest,
  pullRequest:p.pullRequest,bodySha256:p.bodySha256,commentId:12345,
  commentUrl:COMMENT_URL,actor:'ultron-coordinator[bot]',appId:5633654,
  personaRole:'builder',remoteVerified:true}};
}
function botComment(p=prepared()){
 return {id:12345,body:p.commentBody,html_url:COMMENT_URL,
  user:{login:'ultron-coordinator[bot]',id:353078104,type:'Bot'},
  performed_via_github_app:{id:5633654,slug:'ultron-coordinator'}};
}
function makeCase({state='reconcile_required',receipt=null,pages={1:[]},listStatus=200,
 detail=null,detailStatus=200,throwJson=false,deniedCounts={claims:0,events:0},
 storedDigest=DIGEST,target=NUMBER,bodySha=null}={}){
 const p=prepared();let current=state,storedReceipt=receipt;
 let reads=0,posts=0,events=[],updates=0,individualGets=0;
 const db={async query(sql,params=[]){
  if(sql.includes('SELECT idempotency_key,state,operation_digest')){
   return {rows:[{state:current,operation_digest:storedDigest,target_number:target,
    body_sha256:bodySha??p.bodySha256,created_at:new Date('2026-11-17T00:00:00Z').toISOString(),
    receipt:storedReceipt}]};
  }
  if(sql.includes('INSERT INTO brain_events')){
   events.push(params);return {rows:[{id:events.length}]};
  }
  if(sql.includes('WITH denial AS'))return {rows:[deniedCounts]};
  if(sql.includes("SET state='reconcile_required'")){if(current==='in_flight')current='reconcile_required';return {rows:[]};}
  if(sql.includes("SET\n   state='completed'")||sql.includes("SET state='completed'")||
      (sql.includes("UPDATE github_pr_comment_executions SET")&&sql.includes("state='completed'"))){
   current='completed';updates++;storedReceipt=JSON.parse(params[6]);return {rows:[]};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,80));
 }};
 const fetchImpl=async(url,options={})=>{
  if(options.method==='POST'){posts++;throw Error('external POST is forbidden in replay');}
  reads++;
  if(url.includes('/issues/comments/')){
   individualGets++;
   return {status:detailStatus,json:async()=>detail??botComment(p)};
  }
  assert.match(url,/\/repos\/michaeljwilliams0123\/Ultron.MW\/issues\/479\/comments\?/);
  const page=Number(new URL(url).searchParams.get('page'));
  assert.ok(page>=1&&page<=5);
  return {status:listStatus,json:async()=>{
   if(throwJson)throw Error('invalid json response');
   return pages[page]??[];
  }};
 };
 return {p,db,fetchImpl,events,get state(){return current},get receipt(){return storedReceipt},
  reads:()=>reads,posts:()=>posts,updates:()=>updates,individualGets:()=>individualGets};
}
const attempt=t=>reconcilePrCommentCanary({db:t.db,prepared:t.p,
 operationDigest:DIGEST,fetchImpl:t.fetchImpl});

test('edge C04: a completed ledger entry without a durable receipt is never accepted as success',async()=>{
 const t=makeCase({state:'completed'});
 await assert.rejects(attempt(t),/receipt-persistence-unverified/);
 assert.equal(t.reads(),0);assert.equal(t.posts(),0);
});
test('edge C04: completed receipt from another operation digest cannot be replayed',async()=>{
 const t=makeCase({state:'completed',receipt:validReceipt(prepared(),'c'.repeat(64))});
 await assert.rejects(attempt(t),/receipt-persistence-unverified/);
 assert.equal(t.reads(),0);assert.equal(t.posts(),0);
});
test('edge C04: completed receipt without independent remote verification is insufficient',async()=>{
 const r=validReceipt();r.details.remoteVerified=false;
 const t=makeCase({state:'completed',receipt:r});
 await assert.rejects(attempt(t),/receipt-persistence-unverified/);
 assert.equal(t.reads(),0);assert.equal(t.posts(),0);
});
test('edge C04: matching completed receipt returns stored evidence without provider traffic',async()=>{
 const receipt=validReceipt(),t=makeCase({state:'completed',receipt});
 assert.deepEqual(await attempt(t),{status:'recovered_success',receipt});
 assert.equal(t.reads(),0);assert.equal(t.posts(),0);
});
test('edge C04: reserved, cancelled and fabricated states reject reconciliation before reads',async()=>{
 for(const state of ['reserved','cancelled','denied_no_effect','unknown']){
  const t=makeCase({state});
  await assert.rejects(attempt(t),/reconciliation-not-admitted/,state);
  assert.equal(t.reads(),0);assert.equal(t.posts(),0);
 }
});
test('edge C04: ledger target and body digest changes reject matching operation digest',async()=>{
 for(const option of [{target:480},{target:'0'},{bodySha:'c'.repeat(64)},
  {storedDigest:'c'.repeat(64)}]){
  const t=makeCase(option);
  await assert.rejects(attempt(t),/intent-conflict|ledger-readback-unavailable/);
  assert.equal(t.reads(),0);assert.equal(t.posts(),0);
 }
});
test('edge C04: empty healthy readback does not certify no effect without persisted HTTP denial',async()=>{
 const t=makeCase();
 await assert.rejects(attempt(t),/readback-not-found/);
 assert.equal(t.state,'reconcile_required');
 assert.equal(t.reads(),1);assert.equal(t.posts(),0);assert.equal(t.updates(),0);
});
test('edge C04: exactly 100 old comments require a second page to certify completeness',async()=>{
 const old=Array.from({length:100},(_,i)=>({id:20000+i,body:'unrelated'}));
 const t=makeCase({pages:{1:old,2:[]}});
 await assert.rejects(attempt(t),/readback-not-found/);
 assert.equal(t.reads(),2);assert.equal(t.posts(),0);assert.equal(t.updates(),0);
});
test('edge C04: correctly worded forged comments with wrong bot identity or App cannot recover',async()=>{
 const good=botComment(),t=makeCase({pages:{1:[
  {...good,user:{...good.user,id:1}},
  {...good,performed_via_github_app:{...good.performed_via_github_app,id:999}},
  {...good,html_url:'https://evil.invalid/pull/479#issuecomment-12345'},
  {...good,body:good.body+' tampered'}
 ]}});
 await assert.rejects(attempt(t),/readback-not-found/);
 assert.equal(t.state,'reconcile_required');assert.equal(t.individualGets(),0);assert.equal(t.posts(),0);
});
test('edge C04: independently verified matching comment completes recovery without new POST',async()=>{
 const p=prepared(),t=makeCase({pages:{1:[botComment(p)]}});
 const r=await attempt(t);
 assert.equal(r.status,'reconciled_success');
 assert.equal(t.state,'completed');assert.equal(t.posts(),0);
 assert.equal(t.individualGets(),1);assert.equal(t.updates(),1);
 assert.equal(r.receipt.details.remoteVerified,true);
 assert.equal(r.receipt.details.operationDigest,DIGEST);
});
test('edge C04: matching comment on second page is retrieved with no effectful retry',async()=>{
 const old=Array.from({length:100},(_,i)=>({id:30000+i,body:'unrelated'}));
 const t=makeCase({pages:{1:old,2:[botComment()]}});
 assert.equal((await attempt(t)).status,'reconciled_success');
 assert.equal(t.reads(),3);assert.equal(t.posts(),0);
});
test('edge C04: two authenticated matching comments create conflict, never a success receipt',async()=>{
 const t=makeCase({pages:{1:[botComment(),botComment()]}});
 await assert.rejects(attempt(t),/readback-conflict/);
 assert.equal(t.state,'reconcile_required');assert.equal(t.updates(),0);
 assert.equal(t.individualGets(),0);assert.equal(t.posts(),0);
});
test('edge C04: 401, 429 and 503 list readbacks never grant terminal authority',async()=>{
 for(const listStatus of [401,429,503]){
  const t=makeCase({listStatus});
  await assert.rejects(attempt(t),/readback-unavailable/);
  assert.equal(t.state,'reconcile_required');assert.equal(t.posts(),0);
 }
});
test('edge C04: malformed GitHub response JSON never becomes an absent-comment proof',async()=>{
 const t=makeCase({throwJson:true});
 await assert.rejects(attempt(t),/readback-unavailable/);
 assert.equal(t.updates(),0);assert.equal(t.posts(),0);
});
test('edge C04: non-array list body fails closed and never invokes the terminal SQL',async()=>{
 const t=makeCase({pages:{1:{message:'Unexpected provider response'}}});
 await assert.rejects(attempt(t),/readback-unavailable/);
 assert.equal(t.updates(),0);assert.equal(t.posts(),0);
});
test('edge C04: matching list entry with changed owner in independent GET is not accepted',async()=>{
 const suspect={...botComment(),user:{...botComment().user,login:'another[bot]'}};
 const t=makeCase({pages:{1:[botComment()]},detail:suspect});
 await assert.rejects(attempt(t),/readback-mismatch/);
 assert.equal(t.updates(),0);assert.equal(t.posts(),0);
});
test('edge C04: independent GitHub 404 after a matching list entry is not completion',async()=>{
 const t=makeCase({pages:{1:[botComment()]},detailStatus:404});
 await assert.rejects(attempt(t),/readback-unavailable/);
 assert.equal(t.updates(),0);assert.equal(t.posts(),0);
});
test('edge C04: half-persisted terminal SQL audit cannot claim denied-no-effect',async()=>{
 const t=makeCase({deniedCounts:{claims:1,events:0}});
 await assert.rejects(attempt(t),/reconciliation-not-admitted/);
 assert.equal(t.state,'reconcile_required');assert.equal(t.posts(),0);
});
