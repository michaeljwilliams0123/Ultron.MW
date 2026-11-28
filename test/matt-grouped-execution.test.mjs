import test from 'node:test';
import assert from 'node:assert/strict';
import {LANE_IDS,routeCouncilTask,companionReply,createCouncilMemory,recordCouncilOutcome,restoreCouncilMemory,councilScorecard} from '../src/council-of-ultron.mjs';
const cases=[['none',[]],['comment',['pr.comment']],['owner',['pr.merge']],['unknown',['fixture.unregistered']]];
for(const a of LANE_IDS)for(const b of LANE_IDS)for(const [label,operations] of cases)test('group '+a+' '+b+' '+label,()=>{
 const memory=createCouncilMemory({now:()=> '2026-11-28T00:00:00.000Z'});
 const task={id:'fixture-group',objective:'Coordinate case',lanes:[a,b],operations};
 const r=routeCouncilTask(task,{memory});
 assert.deepEqual(r,routeCouncilTask(task,{memory}));
 assert.equal(r.authority,'advisory-only');assert.equal(r.executes,false);assert.equal(r.countsAsApproval,false);
 assert.ok(r.lanes.includes(a)&&r.lanes.includes(b));assert.equal(new Set(r.members.map(m=>m.id)).size,r.members.length);
 if(label==='owner'||label==='unknown'){assert.equal(r.admission[0].admitted,false);assert.equal(r.decision,'escalate-to-owner');}
 const reply=companionReply(r);assert.equal(reply.sent,false);assert.equal(reply.cards.length,r.escalations.length);
 const result=recordCouncilOutcome(memory,r,{status:'succeeded',evidence:'receipt:fixture-group'});
 assert.equal(result.evidenceVerified,false);assert.throws(()=>recordCouncilOutcome(memory,r,{status:'succeeded',evidence:'receipt:fixture-group'}),/already-recorded/);
 const restored=restoreCouncilMemory(JSON.parse(JSON.stringify(memory.snapshot())));
 assert.deepEqual(Object.keys(councilScorecard(restored)),[]);assert.equal(restored.outcomes().length,1);
});
