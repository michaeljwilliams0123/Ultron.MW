import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutonomousRepairPlan} from '../src/autonomous-repair-loop.mjs';
import {createAutonomousRepairGitHubAdapters} from '../src/autonomous-repair-github-adapter.mjs';
import {normalizeRepairStatus} from '../cloud/hatchable/lib/autonomous-repair-status.js';

const OWNER='michaeljwilliams0123';
const REPO='michaeljwilliams0123/Ultron.MW';
const LEGACY='Ultron-MW/Ultron.MW';
const BOT='michaeljwilliams0123ultron';
const REF='ultron/repair-owner-return-001';
const HEAD='a'.repeat(40),now=Date.parse('2026-11-10T12:00:00Z');
function source(overrides={}){
 return {id:'repair-owner-return-001',owner:OWNER,repository:REPO,
 branch:REF,baseSha:HEAD,
 objective:'Verify the canonical owner and repository after redirect',
 allowedPaths:['src/example.mjs'],maxAttempts:2,maxPaidCents:0,
 paidFallback:false,expiresAt:'2026-11-10T14:00:00Z',...overrides};
}
test('canonical owner accepts the personal-account repository',()=>{
 const plan=createAutonomousRepairPlan(source(),now);
 assert.equal(plan.owner,OWNER);
 assert.equal(plan.repository,REPO);
});
test('former organization repository never reauthorizes a new mutation',()=>{
 assert.throws(()=>createAutonomousRepairPlan(source({repository:LEGACY}),now),
  /autonomous-repair-plan-invalid/);
});
test('dedicated Ultron account is not an owner authorization source',()=>{
 assert.throws(()=>createAutonomousRepairPlan(source({owner:BOT}),now),
  /autonomous-repair-plan-invalid/);
});
test('read-only PR inventory uses personal-owner qualifier and target',async()=>{
 const seen=[],base='/repos/'+REPO;
 const get=async path=>{
  seen.push(path);
  if(path===base+'/git/ref/heads/'+REF)
   return {ref:'refs/heads/'+REF,object:{sha:HEAD}};
  if(path===base+'/pulls?state=all&head='+OWNER+':'+
     encodeURIComponent(REF)+'&base=main&per_page=100')
   return [];
  throw Error('unexpected provider route '+path);
 };
 const publisher=createAutonomousRepairGitHubAdapters({
  get,post:async()=>({}),updateRef:async()=>{}
 }).publisher;
 await publisher.start({plan:createAutonomousRepairPlan(source(),now),headSha:HEAD});
 assert.ok(seen.some(path=>path.includes('head='+OWNER+':')));
 assert.equal(seen.some(path=>path.includes('head='+BOT+':')),false);
 assert.equal(seen.some(path=>path.includes('head=Ultron-MW:')),false);
});
test('owner repair status URLs no longer resolve to the organization alias',()=>{
 const row={id:'repair-owner-return-001',fingerprint:'a'.repeat(64),
  phase:'complete',attempt:1,maxAttempts:2,headSha:HEAD,version:3,
  prNumber:360};
 const status=normalizeRepairStatus(row);
 assert.equal(status.prUrl,'https://github.com/'+REPO+'/pull/360');
});
