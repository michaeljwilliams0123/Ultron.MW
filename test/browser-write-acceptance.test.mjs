import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBrowserWriteBody,applyBrowserWrite,browserWriteDigest}
 from '../cloud/hatchable/lib/browser-write-acceptance.js';

const SHA='a'.repeat(40),actor='michaeljwilliams0123';
const request=()=>({schema:'ultron.browser-write.v1',phase:'submit',
 objectiveId:'browser-persisted-acceptance-20261109a',sourceSha:SHA,
 marker:'Ultron-Cloud-External-001',issueNumber:350});
const identity={actor,sha:SHA,event:'issues'};
function pg({ackLoss=false}={}){
 const records=new Map();let next=100,writes=0,reads=0;
 const db={async query(sql,params){
  if(sql.includes('INSERT INTO browser_acceptance_effects')){
   writes++;
   const [key,sourceSha,issueNumber,digest,marker,actor]=params;
   if(records.has(key))return {rows:[]};
   const row={id:++next,objective_key:key,source_sha:sourceSha,
    approval_issue:issueNumber,request_digest:digest,marker,actor,
    created_at:'2026-11-09T16:30:00Z'};
   records.set(key,row);
   if(ackLoss)throw Error('lost-db-ack-after-commit');
   return {rows:[{id:row.id}]};
  }
  if(sql.includes('FROM browser_acceptance_effects')){
   reads++;
   const row=records.get(params[0]);
   return {rows:row?[row]:[]};
  }
  throw Error('unexpected SQL');
 }};
 return {db,records,get writes(){return writes;},get reads(){return reads;}};
}
test('owner OIDC authorizes exactly one persisted, independently re-read browser effect',async()=>{
 const state=pg(),body=request();
 const submitted=await applyBrowserWrite({db:state.db,body,identity});
 assert.equal(submitted.ok,true);
 assert.equal(submitted.receiptId,101);
 assert.equal(submitted.effectCount,1);
 assert.equal(submitted.reused,false);
 const readback=await applyBrowserWrite({db:state.db,
   body:{...body,phase:'readback'},identity});
 assert.equal(readback.ok,true);
 assert.equal(readback.receiptId,101);
 assert.equal(readback.phase,'readback');
 assert.equal(readback.actor,actor);
 const repeated=await applyBrowserWrite({db:state.db,body,identity});
 assert.equal(repeated.ok,true);
 assert.equal(repeated.reused,true);
 assert.equal(repeated.receiptId,101);
 assert.equal(state.records.size,1);
 assert.equal(state.reads,3);
});
test('uncertain DB write acknowledgment is reconciled by readback without another write',async()=>{
 const state=pg({ackLoss:true});
 const response=await applyBrowserWrite({db:state.db,body:request(),identity});
 assert.equal(response.ok,true);
 assert.equal(response.reused,true);
 assert.equal(state.writes,1);
 assert.equal(state.records.size,1);
});
test('conflicting payload for the same objective cannot rewrite an accepted effect',async()=>{
 const state=pg();
 await applyBrowserWrite({db:state.db,body:request(),identity});
 const denied=await applyBrowserWrite({db:state.db,
  body:{...request(),marker:'Ultron-Cloud-External-002'},identity});
 assert.equal(denied.ok,false);
 assert.equal(denied.status,409);
 assert.equal(state.records.size,1);
});
test('OIDC actor, workflow event and exact source SHA cannot drift',async()=>{
 const state=pg();
 for(const bad of [
  {...identity,actor:'github-actions[bot]'}, {...identity,event:'push'},
  {...identity,sha:'b'.repeat(40)}]){
  const r=await applyBrowserWrite({db:state.db,body:request(),identity:bad});
  assert.equal(r.ok,false);assert.equal(r.status,403);
 }
 assert.equal(state.writes,0);
});
test('missing independent readback stays missing and creates nothing',async()=>{
 const state=pg();
 const r=await applyBrowserWrite({db:state.db,body:{...request(),phase:'readback'},identity});
 assert.equal(r.ok,false);assert.equal(r.status,404);
 assert.equal(state.writes,0);
});
test('strict input shape and credential-like markers fail closed',()=>{
 assert.equal(parseBrowserWriteBody(JSON.stringify(request())).phase,'submit');
 const invalid=[{...request(),phase:'verified'},{...request(),marker:'password=abc'},
  {...request(),sourceSha:'bad'},{...request(),issueNumber:0},
  {...request(),unexpected:1}];
 for(const value of invalid)assert.throws(
  ()=>parseBrowserWriteBody(JSON.stringify(value)),/browser-write-/);
 assert.equal(browserWriteDigest(request()),
  browserWriteDigest({...request(),phase:'readback'}));
});
