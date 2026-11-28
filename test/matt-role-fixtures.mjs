import test from 'node:test';
import assert from 'node:assert/strict';
import {COUNCIL_ROSTER,LANE_IDS,validateMemberProfile,createCouncilMemory,restoreCouncilMemory,councilScorecard} from '../src/council-of-ultron.mjs';
import {snapshotSha} from '../src/git-hubs.mjs';

const now=()=> '2026-11-28T00:00:00.000Z';
const ev='receipt:fixture-0001';
const invalidProfiles=[
 ['identity wrong',{id:'ultron-intruder'}],['identity missing',{id:null}],
 ['role unknown',{role:'Intruder'}],['role absent',{role:null}],
 ['name blank',{name:' '}],['name too long',{name:'a'.repeat(61)}],['name type',{name:42}],
 ['description blank',{description:''}],['description too long',{description:'a'.repeat(301)}],
 ['description type',{description:[]}],['primary lane unknown',{primaryLane:'unknown'}],
 ['secondary lanes type',{secondaryLanes:null}],['secondary lane unknown',{secondaryLanes:['unknown']}],
 ['skill list empty',{skills:[]}],['skill list missing',{skills:null}],['skill malformed',{skills:['?']}],
 ['skill wrong type',{skills:[42]}],['routine list missing',{routines:null}],
 ['routine malformed',{routines:[{kind:'cron',schedule:'often',prompt:'x'}]}],
 ['routine prompt missing',{routines:[{kind:'event',on:'issues.opened'}]}],
 ['namespace mismatched',{memoryNamespace:'council/intruder'}],
 ['tools invalid',{tools:null}],['owner-only merge',{tools:['pr.merge']}],
 ['unregistered tool',{tools:['fixture.unregistered']}]
];
const badKeys=[null,'','x','UPPER','_key','a b','a/b','a'.repeat(65),'constructor','prototype'];
const badValues=[null,undefined,42,false,[],{},'',' ','a'.repeat(501),'ghp_'+'x'.repeat(30)];
const badJournals=[
 {kind:'?'},{kind:'a'},{kind:'a'.repeat(33)},{lane:'unknown'},{outcome:'pending'},
 {text:''},{text:'a'.repeat(1001)},{text:42},{text:'ghp_'+'x'.repeat(30)},{evidence:['not-evidence']}
];
const badEvidence=[null,undefined,[],[''],['receipt:x'],['sha256:bad'],['https://example.com/x'],
 ['https://github.com/other/repo/pull/1'],Array(11).fill(ev),[ev,42]];
export function registerRole(role){
 const member=COUNCIL_ROSTER.find(m=>m.role===role);
 const p=role.toLowerCase();
 for(const [label,patch] of invalidProfiles)test(p+' profile '+label,()=>{
  assert.throws(()=>validateMemberProfile({...structuredClone(member),...patch}),/council-of-ultron-profile-/);
  assert.equal(member.skills.includes('matt-engineering'),true);
 });
 for(const peer of COUNCIL_ROSTER)for(const lane of LANE_IDS)test(p+' memory '+peer.role+' '+lane,()=>{
  const memory=createCouncilMemory({now});
  memory.remember(member.id,'fixture.fact',lane);
  memory.journal(member.id,{text:'fixture '+lane,lane,evidence:[ev]});
  memory.share(member.id,{fact:'shared '+lane,evidence:ev});
  if(peer.id!==member.id)memory.remember(peer.id,'fixture.fact','peer '+lane);
  const restored=restoreCouncilMemory(JSON.parse(JSON.stringify(memory.snapshot())),{now});
  assert.equal(restored.recall(member.id).profile['fixture.fact'].value,lane);
  assert.equal(restored.recall(member.id).journal[0].lane,lane);
  assert.equal(restored.recall(peer.id).shared[0].by,member.id);
  if(peer.id!==member.id){assert.equal(restored.recall(peer.id).profile['fixture.fact'].value,'peer '+lane);assert.equal(restored.recall(peer.id).journal.length,0);}
  assert.equal(Object.isFrozen(restored.recall(peer.id)),true);
 });
 for(const lane of LANE_IDS)for(const status of ['succeeded','failed','held'])for(const [label,flag] of [['verified',true],['unverified',false],['string','true']])test(p+' score '+lane+' '+status+' '+label,()=>{
  const memory=createCouncilMemory({now});
  memory.recordOutcome({routing:snapshotSha({role,lane,status,label}),taskId:'fixture-case',lead:member.id,lanes:[lane],status,evidence:[ev],evidenceVerified:flag});
  const restored=restoreCouncilMemory(JSON.parse(JSON.stringify(memory.snapshot())),{now});
  const slot=councilScorecard(restored)[member.id]?.[lane];
  if(flag!==true)assert.equal(slot,undefined);
  else if(status==='held'){assert.equal(slot.attempts,0);assert.equal(slot.successes,0);}
  else {assert.equal(slot.attempts,1);assert.equal(slot.successes,status==='succeeded'?1:0);assert.equal(slot.rate,status==='succeeded'?0.6667:0.3333);}
 });
 for(const [i,key] of badKeys.entries())test(p+' fact key '+i,()=>{
  const m=createCouncilMemory({now});assert.throws(()=>m.remember(member.id,key,'fixture'),/fact-key-invalid/);assert.deepEqual(Object.keys(m.recall(member.id).profile),[]);
 });
 for(const [i,value] of badValues.entries())test(p+' fact value '+i,()=>{
  const m=createCouncilMemory({now});assert.throws(()=>m.remember(member.id,'fixture.fact',value),/fact-invalid|credential-like/);assert.deepEqual(Object.keys(m.recall(member.id).profile),[]);
 });
 for(const [i,patch] of badJournals.entries())test(p+' journal invalid '+i,()=>{
  const m=createCouncilMemory({now});assert.throws(()=>m.journal(member.id,{text:'fixture',...patch}),/journal-|credential-like|evidence-invalid/);assert.equal(m.recall(member.id).journal.length,0);
 });
 for(const [i,evidence] of badEvidence.entries())test(p+' shared evidence invalid '+i,()=>{
  const m=createCouncilMemory({now});assert.throws(()=>m.share(member.id,{fact:'fixture',evidence}),/evidence-invalid/);assert.equal(m.recall(member.id).shared.length,0);
 });
}
