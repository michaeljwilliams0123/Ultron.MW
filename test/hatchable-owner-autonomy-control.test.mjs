import test from 'node:test';
import assert from 'node:assert/strict';
import {readOwnerProfile,setOwnerProfile,normalizeOwnerProfile,DEFAULT_OPERATIONS}
 from '../cloud/hatchable/lib/owner-autonomy-control.js';
import {readFile} from 'node:fs/promises';

const BUILD=['research.public','repo.inspect','plan.create','test.local',
'evidence.read','branch.create','branch.update','pr.open','pr.comment',
'verify.dispatch','capability.sandbox.propose','capability.sandbox.test'];
const before=()=>({owner:'michaeljwilliams0123',preset:'build',version:7,
  maxPaidCents:0,paused:false,stopVersion:3,
  allowedOperations:[...BUILD],
  limits:{maxFiles:12,maxFileBytes:24000,maxTotalBytes:96000,maxConcurrent:4,maxSteps:32},
  updatedAt:'2026-11-02T21:30:00.000Z'});
function database({changed=true,failWrite=false}={}){
 const queries=[],old=before(),next={...old,preset:'observe',version:8,
    allowedOperations:['research.public','repo.inspect','evidence.read'],
    limits:{maxFiles:4,maxFileBytes:6500,maxTotalBytes:18000,maxConcurrent:1,maxSteps:8}};
 let active=false;
 return {queries,db:{async query(sql,params=[]){
   queries.push({sql,params});
   if(sql.includes('WITH moved AS')){
     assert.match(sql,/UPDATE brain_owner_autonomy_profile/);
     assert.match(sql,/brain_runtime_control/);
     assert.match(sql,/version=\$4/);
     assert.match(sql,/paused=FALSE/);
     assert.match(sql,/INSERT INTO brain_events/);
     if(changed)active=true;
     if(failWrite)throw Error('simulated lost acknowledgement');
     return {rows:changed?[{version:8,receiptId:91}]:[]};
   }
   if(sql.includes('FROM brain_owner_autonomy_profile')){
     return {rows:[active?next:old]};
   }
   throw Error('unexpected query');
 }}};
}
test('default profile is Build, costs zero, never authorizes execution by itself',()=>{
 assert.deepEqual(DEFAULT_OPERATIONS.build,BUILD);
 const p=normalizeOwnerProfile(before());
 assert.equal(p.preset,'build');
 assert.equal(p.version,7);
 assert.equal(p.executionAuthorized,false);
 assert.equal(p.runtimeEnforced,false);
 assert.equal(p.maxPaidCents,0);
 assert.equal(p.paused,false);
 assert.ok(Object.isFrozen(p.allowedOperations));
});
test('owner reads one durable profile alongside the independent global stop switch',async()=>{
 const f=database();
 const x=await readOwnerProfile({db:f.db});
 assert.equal(x.preset,'build');
 assert.match(f.queries[0].sql,/JOIN brain_runtime_control/);
 assert.equal(f.queries.length,1);
});
test('owner updates profile with exact-version CAS and durable event receipt',async()=>{
 const f=database();
 const r=await setOwnerProfile({db:f.db,expectedVersion:7,
   preset:'observe',allowedOperations:['research.public','repo.inspect','evidence.read'],
   limits:{maxFiles:4,maxFileBytes:6500,maxTotalBytes:18000,maxConcurrent:1,maxSteps:8},
   reason:'narrow-authorization'});
 assert.equal(r.ok,true);
 assert.equal(r.profile.preset,'observe');
 assert.equal(r.profile.version,8);
 assert.equal(r.profile.executionAuthorized,false);
 assert.equal(r.receiptId,91);
 assert.equal(f.queries.length,2);
});
test('conflicting version is rejected without an authorization receipt',async()=>{
 const f=database({changed:false});
 const r=await setOwnerProfile({db:f.db,expectedVersion:7,
   preset:'observe',allowedOperations:['research.public','repo.inspect','evidence.read'],
   limits:{maxFiles:4,maxFileBytes:6500,maxTotalBytes:18000,maxConcurrent:1,maxSteps:8},
   reason:'owner-change'});
 assert.deepEqual(r,{ok:false,error:'version-conflict'});
});
test('lost write acknowledgment reconciles once without reapplying profile changes',async()=>{
 const f=database({failWrite:true});
 const r=await setOwnerProfile({db:f.db,expectedVersion:7,
   preset:'observe',allowedOperations:['research.public','repo.inspect','evidence.read'],
   limits:{maxFiles:4,maxFileBytes:6500,maxTotalBytes:18000,maxConcurrent:1,maxSteps:8},
   reason:'owner-change'});
 assert.equal(r.ok,true);
 assert.equal(r.reconciled,true);
 assert.equal(f.queries.filter(q=>q.sql.includes('WITH moved AS')).length,1);
});
test('cannot install privilege, unknown operation, paid fallback, excessive quotas or forged owner',async()=>{
 const dangerous=[
  {preset:'release',allowedOperations:['pr.self.approve']},
  {preset:'release',allowedOperations:['permissions.widen']},
  {preset:'release',allowedOperations:['billing.spend']},
  {preset:'release',allowedOperations:['not.a.real.operation']},
  {preset:'build',limits:{maxConcurrent:10}},
  {preset:'build',limits:{maxFiles:65}},
  {preset:'build',maxPaidCents:5},
  {preset:'build',owner:'different-owner'},
 ];
 for(const v of dangerous){
   const f=database();
   await assert.rejects(setOwnerProfile({db:f.db,expectedVersion:7,
     reason:'owner-change',...v}),/invalid-autonomy-profile/);
   assert.equal(f.queries.length,0);
 }
});
test('forged or getter-based update cannot trigger database reads or changes',async()=>{
 const f=database();let reads=0;
 const value={preset:'build',expectedVersion:7,reason:'owner-change'};
 Object.defineProperty(value,'allowedOperations',{enumerable:true,
   get(){reads++;return ['admin.modify']}});
 await assert.rejects(setOwnerProfile({db:f.db,...value}),/invalid-autonomy-profile/);
 assert.equal(f.queries.length,0);
 assert.equal(reads,1); // JS argument spreading happens outside the validator; no authorization granted.
});
test('admin route is protected, landing includes owner panel, and migration is additive',async()=>{
 const [api,page,sql]=await Promise.all([
   readFile(new URL('../cloud/hatchable/api/brain/autonomy.js',import.meta.url),'utf8'),
   readFile(new URL('../cloud/hatchable/public/index.html',import.meta.url),'utf8'),
   readFile(new URL('../cloud/hatchable/migrations/0016_owner_autonomy_profile.sql',import.meta.url),'utf8')
 ]);
 assert.match(api,/export const access='admin'/);
 assert.match(api,/export const methods=\['GET','POST'\]/);
 assert.match(api,/setOwnerProfile/);
 assert.match(page,/Autonomy profiles/);
 assert.match(page,/api\/brain\/autonomy/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS brain_owner_autonomy_profile/);
 assert.match(sql,/INSERT INTO brain_owner_autonomy_profile/);
 assert.match(sql,/VALUES \(1,'michaeljwilliams0123','build'/);
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM brain_tasks/i);
});
