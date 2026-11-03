import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDeepIssue} from '../cloud/hatchable/lib/deep-issue-workflow.js';
import {readFile} from 'node:fs/promises';

const request=()=>({
 key:'deep-c06-runtime-canary-001',
 title:'C06 owner-directed verified issue workflow',
 body:'Create one scoped implementation objective and prove external readback.',
 expectedMainSha:'a'.repeat(40)
});
function fixture({paused=false,failDispatchAck=false}={}){
 const rows=new Map(),counters={sends:0,reconciles:0,observations:0},actions=new Map();
 const db={async query(sql,params=[]){
  if(sql.includes('FROM brain_owner_autonomy_profile a'))
   return {rows:[{owner:'michaeljwilliams0123',preset:'release',version:4,
     maxPaidCents:0,paused,stopVersion:3}]};
  if(sql.includes('INSERT INTO brain_deep_objectives')){
   const [key,fingerprint,profileVersion,stopVersion]=params;
   if(!rows.has(key))rows.set(key,{key,fingerprint,profileVersion,stopVersion,state:'prepared',issueNumber:null,url:null});
   return {rows:[]};
  }
  if(sql.includes('FROM brain_deep_objectives WHERE task_key=$1'))
   return {rows:rows.has(params[0])?[{...rows.get(params[0])}]:[]};
  if(sql.includes("SET state='dispatching'")){
   const row=rows.get(params[0]);if(!row||row.state!=='prepared')return{rows:[]};
   row.state='dispatching';
   if(failDispatchAck)throw Error('database write committed, reply lost');
   return {rows:[{...row}]};
  }
  if(sql.includes("SET state='reconcile-required'")){
   const row=rows.get(params[0]);
   if(row&&row.state==='dispatching')row.state='reconcile-required';
   return {rows:row?[{...row}]:[]};
  }
  if(sql.includes("SET state='observed'")){
   const row=rows.get(params[0]);
   if(!row||!['dispatching','reconcile-required'].includes(row.state))return{rows:[]};
   row.state='observed';row.issueNumber=params[2];row.url=params[3];
   return {rows:[{...row}]};
  }
  throw Error('unrecognized SQL '+sql.slice(0,50));
 }};
 const observe=async key=>{
  counters.observations++;
  const action=actions.get(key);
  return action?{ok:true,action:{state:action.state,
   action_key:key,operation:'issue.create',result:action.result}}:
   {ok:false,error:'not-found'};
 };
 const send=async action=>{
  counters.sends++;
  const result={kind:'issue',number:1200,
    url:'https://github.com/michaeljwilliams0123/mahoraga/issues/1200'};
  actions.set(action.key,{state:'observed',result});
  return {ok:true,state:'observed',result};
 };
 const reconcile=async action=>{counters.reconciles++;return observe(action.key);};
 return {db,send,reconcile,observe,counters,rows,actions};
}
test('RED: live owner-scoped sequence reserves, dispatches once, checks external action and persists terminal result',async()=>{
 const h=fixture(),r=await executeDeepIssue({...h,request:request()});
 assert.equal(r.status,'completed');assert.equal(r.externalIssueNumber,1200);
 assert.equal(r.profileVersion,4);assert.equal(r.stopVersion,3);
 assert.equal(h.counters.sends,1);
 assert.equal(h.rows.get(request().key).state,'observed');
 const repeat=await executeDeepIssue({...h,request:request()});
 assert.equal(repeat.status,'completed');assert.equal(repeat.reused,true);
 assert.equal(h.counters.sends,1,'same key never causes another external write');
});
test('RED: stale owner pause prevents any new provider side effect',async()=>{
 const h=fixture({paused:true}),r=await executeDeepIssue({...h,request:request()});
 assert.equal(r.status,'held');assert.equal(h.counters.sends,0);
 assert.equal(h.rows.size,0);
});
test('RED: signed-intent boundary survives lost database dispatch acknowledgment',async()=>{
 const h=fixture({failDispatchAck:true});
 const first=await executeDeepIssue({...h,request:request()});
 assert.equal(first.status,'reconcile-required');
 assert.equal(h.counters.sends,0,'ambiguous reservation cannot allow blind send');
 const second=await executeDeepIssue({...h,request:request()});
 assert.equal(second.status,'reconcile-required');
 assert.equal(h.counters.sends,0);
 assert.ok(h.counters.reconciles>=1);
});
test('RED: unknown external outcome is reconciled without repeating provider dispatch',async()=>{
 const h=fixture(),o=h.observe,hits={once:false};
 h.observe=async key=>{if(!hits.once){hits.once=true;return{ok:false,error:'unknown'}}return o(key)};
 const r=await executeDeepIssue({...h,request:request()});
 assert.equal(r.status,'reconcile-required');
 assert.equal(h.counters.sends,1);
 h.observe=o;
 const again=await executeDeepIssue({...h,request:request()});
 assert.equal(again.status,'completed');
 assert.equal(h.counters.sends,1);
});
test('RED: same key with changed title, body or source is a conflict',async()=>{
 const h=fixture();await executeDeepIssue({...h,request:request()});
 for(const p of [{title:'Changed title'},{body:'Changed body'},
  {expectedMainSha:'b'.repeat(40)}]){
  const r=await executeDeepIssue({...h,request:{...request(),...p}});
  assert.equal(r.status,'held');assert.equal(r.reason,'idempotency-conflict');
 }
 assert.equal(h.counters.sends,1);
});
test('RED: no secret, arbitrary operation or unexpected JSON fields accepted',async()=>{
 for(const modified of [{token:'abc'},{operation:'admin.modify'},
  {key:'bad'},{title:'x'.repeat(180)},{expectedMainSha:'not-sha'}]){
  const h=fixture();
  const r=await executeDeepIssue({...h,request:{...request(),...modified}});
  assert.equal(r.status,'held');
  assert.equal(h.counters.sends,0);
 }
});
test('RED: migration holds immutable identity and unique work receipts',async()=>{
 const text=await readFile(new URL('../cloud/hatchable/migrations/0018_deep_objectives.sql',import.meta.url),'utf8');
 assert.match(text,/CREATE TABLE IF NOT EXISTS brain_deep_objectives/);
 assert.match(text,/task_key text PRIMARY KEY/);
 assert.match(text,/fingerprint text NOT NULL/);
 assert.match(text,/CREATE TRIGGER deep_objectives_guard/);
 assert.match(text,/BEFORE UPDATE OR DELETE ON brain_deep_objectives/);
});
