import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
 normalizeRepairStatus,listRepairStatuses,getRepairStatus
} from '../cloud/hatchable/lib/autonomous-repair-status.js';
import {
 formatRepairPhase,fetchRepairInventory,buildRepairConsoleModel
} from '../cloud/hatchable/public/repair-operations.js';

const SHA='a'.repeat(40),ID='repair-console-0001';
function record(overrides={}){
 return {id:ID,fingerprint:createHash('sha256').update(ID).digest('hex'),
  phase:'patch-dispatched',attempt:2,headSha:SHA,
  version:7,manifest:{changes:[{after:'PRIVATE-PATCH-CONTENT',path:'src/one.mjs'}]},
  errorTrace:'password=SECRET-DO-NOT-RENDER',patchDigest:'b'.repeat(64),
  prNumber:null,...overrides};
}
function dbFixture(){
 const rows=[{record_json:JSON.stringify(record()),
  updated_at:'2026-11-09T23:30:00.000Z'}],seen=[];
 return {seen,async query(sql,params){
  seen.push({sql,params});
  if(sql.includes('WHERE repair_id=$1'))
   return {rows:params[0]===ID?rows:[]};
  if(sql.includes('LIMIT $1'))return {rows:rows.slice(0,params[0])};
  throw Error('unknown SQL');
 }};
}
test('operator snapshot contains no code patch, raw failure trace, secret, or privileged action',()=>{
 const result=normalizeRepairStatus(record(),'2026-11-09T23:30:00.000Z');
 assert.deepEqual(Object.keys(result).sort(),
  ['attempt','headSha','id','maxAttempts','nextAction','phase','prUrl','progressPercent',
   'recoveryMode','updatedAt','version'].sort());
 assert.equal(result.phase,'patch-dispatched');
 assert.equal(result.recoveryMode,'readback-only');
 assert.equal(result.attempt,2);
 assert.equal(result.nextAction.includes('replay'),false);
 assert.equal(JSON.stringify(result).includes('PRIVATE-PATCH-CONTENT'),false);
 assert.equal(JSON.stringify(result).includes('SECRET-DO-NOT-RENDER'),false);
});
test('all checkpoint phases have actionable, non-misleading operator states',()=>{
 const phases=['ready','patch-dispatched','applied','verifying','verified',
  'publication-dispatched','complete','exhausted'];
 const expected=['authorized-repair','readback-only','verify',
  'readback-only','authorized-publication','readback-only','none','manual-review'];
 for(let i=0;i<phases.length;i++){
  const item=normalizeRepairStatus(record({phase:phases[i],
   prNumber:phases[i]==='complete'?23:null}),null);
  assert.equal(item.recoveryMode,expected[i],phases[i]);
  assert.ok(item.nextAction.length>12);
  assert.ok(item.progressPercent>=0&&item.progressPercent<=100);
  assert.equal(item.prUrl,phases[i]==='complete'?
   'https://github.com/michaeljwilliams0123/Ultron.MW/pull/23':null);
 }
 assert.match(formatRepairPhase('reconcile-required'),/Reconcile/);
});
test('owner inventory is bounded, parameterized, and has independent row validation',async()=>{
 const db=dbFixture();
 const found=await listRepairStatuses({db,limit:20});
 assert.equal(found.length,1);assert.equal(found[0].id,ID);
 assert.ok(db.seen[0].sql.includes('LIMIT $1'));
 assert.deepEqual(db.seen[0].params,[20]);
 await assert.rejects(listRepairStatuses({db,limit:101}),/invalid/);
 await assert.rejects(getRepairStatus({db,id:"x';DROP TABLE repair;--"}),/invalid/);
 const detail=await getRepairStatus({db,id:ID});
 assert.equal(detail.recoveryMode,'readback-only');
 assert.deepEqual(db.seen.at(-1).params,[ID]);
 assert.equal(await getRepairStatus({db,id:'repair-missing-0001'}),null);
});
test('missing or malformed checkpoint rows never become verified completion',()=>{
 assert.throws(()=>normalizeRepairStatus(record({phase:'complete',prNumber:null})),/invalid/);
 assert.throws(()=>normalizeRepairStatus(record({phase:'made-up'})),/invalid/);
 assert.throws(()=>normalizeRepairStatus(record({headSha:'not-sha'})),/invalid/);
 assert.throws(()=>normalizeRepairStatus(record({version:-1})),/invalid/);
});
test('repair console fetcher differentiates owner-session denial, outage, and live empty inventory',async()=>{
 const base='https://test.local/api/brain/autonomous-repairs?limit=25';
 const denied=await fetchRepairInventory(async()=>({ok:false,status:403}),base);
 assert.equal(denied.state,'owner-required');
 const unavailable=await fetchRepairInventory(async()=>{throw Error('Bearer SUPER-SECRET');},base);
 assert.equal(unavailable.state,'unavailable');
 assert.doesNotMatch(JSON.stringify(unavailable),/SUPER-SECRET/);
 const ok=await fetchRepairInventory(async()=>({ok:true,status:200,json:async()=>({
  schema:'ultron.autonomous-repairs.status.v1',ok:true,items:[],observedAt:'2026-11-09T23:30:00.000Z'
 })}),base);
 assert.equal(ok.state,'live');
 assert.deepEqual(ok.items,[]);
 assert.equal(buildRepairConsoleModel(ok).headline,'No repair attempts recorded');
});
test('repair console refuses unverified response envelopes, unsupported statuses, and spoofed PR URLs',()=>{
 const view=buildRepairConsoleModel({state:'live',items:[{
  id:ID,phase:'complete',attempt:1,maxAttempts:3,headSha:SHA,
  version:4,nextAction:'PR is open',progressPercent:100,
  recoveryMode:'none',updatedAt:null,
  prUrl:'https://evil.example/malicious'
 }]});
 assert.equal(view.items.length,1);
 assert.equal(view.items[0].prUrl,null);
});
test('read-only admin route and a genuinely navigable repair console are present',()=>{
 const route=readFileSync(new URL('../cloud/hatchable/api/brain/autonomous-repairs.js',import.meta.url),'utf8');
 const page=readFileSync(new URL('../cloud/hatchable/public/repair-operations.html',import.meta.url),'utf8');
 const home=readFileSync(new URL('../cloud/hatchable/public/index.html',import.meta.url),'utf8');
 assert.match(route,/export const access='admin'/);
 assert.match(route,/export const methods=\['GET'\]/);
 assert.doesNotMatch(route,/methods=\['POST'\]/);
 assert.match(page,/id="repair-refresh"/);
 assert.match(page,/aria-live="polite"/);
 assert.match(page,/repair-operations\.js/);
 assert.match(home,/href="\/repair-operations\.html"/);
});
