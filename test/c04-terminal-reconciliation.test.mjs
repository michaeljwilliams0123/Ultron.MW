import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const moduleSource=readFileSync(new URL('../cloud/hatchable/lib/github-pr-comment-canary.js',import.meta.url),'utf8')
 .replace("'lib/rsa-pkcs1-sign.js'",JSON.stringify(new URL('../cloud/hatchable/lib/rsa-pkcs1-sign.js',import.meta.url).href));
const {canonicalCanaryComment,reconcilePrCommentCanary}=await import(
 'data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
function setup({providerDenied403=false,commentsPerPage=0,completeRace=false}={}){
 const number=478,key='ultron-task-c04-pr478-'+'a'.repeat(24);
 const commentBody=canonicalCanaryComment({pullRequest:number,idempotencyKey:key});
 const prepared={pullRequest:number,idempotencyKey:key,commentBody,
  bodySha256:createHash('sha256').update(commentBody).digest('hex')};
 const digest='d'.repeat(64);
 const state={value:'reconcile_required',events:[],queries:[],writes:0,gets:0};
 const db={async query(sql,params){
  state.queries.push({sql,params});
  if(sql.includes('SELECT idempotency_key,state,operation_digest')){
   return {rows:[{state:state.value,operation_digest:digest,
    target_number:number,body_sha256:prepared.bodySha256,
    created_at:new Date(Date.now()-60000).toISOString(),
    receipt:state.value==='completed'?{race:'completed'}:null}]};
  }
  if(sql.includes('WITH denial AS') && sql.includes('denied_no_effect')){
   if(completeRace){
    state.value='completed';
    return {rows:[{claims:0,events:0}]};
   }
   const eligible=providerDenied403&&state.value==='reconcile_required';
   if(eligible)state.value='denied_no_effect';
   return {rows:[{claims:eligible?1:0,events:eligible?1:0}]};
  }
  if(sql.includes('INSERT INTO brain_events')){
   state.events.push({sql,params});return {rows:[{id:state.events.length}]};
  }
  if(sql.includes("SET state='reconcile_required'"))return {rows:[]};
  throw Error('unexpected database query: '+sql.slice(0,90));
 }};
 const fetchImpl=async(url,options={})=>{
  if(options.method==='POST'){state.writes++;throw Error('provider POST prohibited in reconciliation');}
  state.gets++;
  if(!url.includes('/issues/'+number+'/comments?'))throw Error('wrong endpoint '+url);
  return {status:200,json:async()=>Array.from({length:commentsPerPage},(_,i)=>({
   id:200000+i,body:'not our comment'}))};
 };
 return {prepared,digest,state,db,fetchImpl};
}
test('definitive persisted provider HTTP 403 and complete empty readback permit terminal denial without retry',async()=>{
 const t=setup({providerDenied403:true});
 const r=await reconcilePrCommentCanary({db:t.db,prepared:t.prepared,
  operationDigest:t.digest,fetchImpl:t.fetchImpl});
 assert.deepEqual(r,{status:'denied_no_effect',receipt:null});
 assert.equal(t.state.value,'denied_no_effect');
 assert.equal(t.state.writes,0);assert.equal(t.state.gets,1);
 assert.ok(t.state.queries.some(q=>q.sql.includes('WITH denial AS')&&
  q.sql.includes("providerHttpStatus")&&q.sql.includes('denied_no_effect')));
 await assert.rejects(reconcilePrCommentCanary({db:t.db,prepared:t.prepared,
  operationDigest:t.digest,fetchImpl:t.fetchImpl}),/reconciliation-not-admitted/);
});
test('unverified provider outcome never becomes a terminal denial after zero-match readback',async()=>{
 const t=setup();
 await assert.rejects(reconcilePrCommentCanary({db:t.db,prepared:t.prepared,
  operationDigest:t.digest,fetchImpl:t.fetchImpl}),/readback-not-found/);
 assert.equal(t.state.value,'reconcile_required');
 assert.equal(t.state.writes,0);
});
test('five full pages of comments cannot certify absence or produce a terminal denial',async()=>{
 const t=setup({providerDenied403:true,commentsPerPage:100});
 await assert.rejects(reconcilePrCommentCanary({db:t.db,prepared:t.prepared,
  operationDigest:t.digest,fetchImpl:t.fetchImpl}),/readback-unavailable/);
 assert.equal(t.state.gets,5);
 assert.equal(t.state.value,'reconcile_required');
 assert.equal(t.state.writes,0);
 assert.equal(t.state.queries.some(q=>q.sql.includes('WITH denial AS')),false);
});
test('a concurrent completion wins over the denial compare-and-set without being downgraded',async()=>{
 const t=setup({providerDenied403:true,completeRace:true});
 const r=await reconcilePrCommentCanary({db:t.db,prepared:t.prepared,
  operationDigest:t.digest,fetchImpl:t.fetchImpl});
 assert.deepEqual(r,{status:'recovered_success',receipt:{race:'completed'}});
 assert.equal(t.state.value,'completed');
 assert.equal(t.state.writes,0);
 assert.equal(t.state.gets,1);
});
