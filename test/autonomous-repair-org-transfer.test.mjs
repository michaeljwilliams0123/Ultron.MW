import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutonomousRepairPlan} from '../src/autonomous-repair-loop.mjs';
import {createAutonomousRepairGitHubAdapters} from '../src/autonomous-repair-github-adapter.mjs';

const REPO = 'Ultron-MW/Ultron.MW';
const ROOT = '/repos/' + REPO;
const BRANCH = 'ultron/repair-org-migration-001';
const SHA = 'a'.repeat(40);
const now = Date.parse('2026-11-10T12:00:00Z');
const requestedPlan = (repository = REPO) => ({
 id:'repair-org-migration-001',
 owner:'michaeljwilliams0123',
 repository,
 branch:BRANCH,
 baseSha:SHA,
 objective:'Restore canonical organization repair publication',
 allowedPaths:['src/example.mjs'],
 maxAttempts:3,
 maxPaidCents:0,
 paidFallback:false,
 expiresAt:'2026-11-10T14:00:00Z'
});
test('Owner remains the original human but repair operations pin new repository', () => {
 const plan = createAutonomousRepairPlan(requestedPlan(),now);
 assert.equal(plan.owner,'michaeljwilliams0123');
 assert.equal(plan.repository,REPO);
 assert.equal(plan.maxPaidCents,0);
 assert.throws(() => createAutonomousRepairPlan(
  requestedPlan('michaeljwilliams0123/Ultron.MW'),now
 ),/autonomous-repair-plan-invalid/);
});
test('Repair PR inventory and publication use the organization owner, not former personal owner',async()=>{
 const plan=createAutonomousRepairPlan(requestedPlan(),now);
 const calls=[];
 const get=async path=>{
  calls.push(['GET',path]);
  if(path===ROOT+'/git/ref/heads/'+BRANCH)
   return {ref:'refs/heads/'+BRANCH,object:{sha:SHA}};
  if(path===ROOT+'/pulls?state=all&head=Ultron-MW:'+encodeURIComponent(BRANCH)+
     '&base=main&per_page=100')
   return [];
  throw Error('Unexpected inventory path: '+path);
 };
 const post=async(path,body)=>{
  calls.push(['POST',path]);
  assert.equal(path,ROOT+'/pulls');
  assert.equal(body.head,BRANCH);
  assert.equal(body.base,'main');
  assert.equal(body.draft,false);
  return {number:412};
 };
 const publisher=createAutonomousRepairGitHubAdapters({
  get,post,updateRef:async()=>{throw Error('No ref updates authorized');}
 }).publisher;
 await publisher.start({plan,headSha:SHA});
 assert.equal(calls.filter(x=>x[0]==='POST').length,1);
 assert.ok(calls.some(x=>x[0]==='GET'&&x[1].includes('head=Ultron-MW:')));
 assert.equal(calls.some(x=>x[1].includes('head=michaeljwilliams0123:')),false);
});
