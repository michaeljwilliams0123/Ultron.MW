import test from 'node:test';
import assert from 'node:assert/strict';
import {LANE_IDS,OWNER_ONLY_OPERATIONS,routeCouncilTask,companionReply,createCouncilMemory,recordCouncilOutcome} from '../src/council-of-ultron.mjs';
import {snapshotSha} from '../src/git-hubs.mjs';
const variants=[['execution',{executes:true}],['approval',{countsAsApproval:true}],['authority',{authority:'owner-approved'}],['escalation',{escalations:[],decision:'route'}]];
for(const op of OWNER_ONLY_OPERATIONS)for(const lane of LANE_IDS)for(const [label,patch] of variants)test('scope '+op+' '+lane+' '+label,()=>{
 const r=routeCouncilTask({id:'fixture-scope',objective:'Coordinate case',lanes:[lane],operations:[op]});
 assert.equal(r.admission[0].admitted,false);
 const {fingerprint,...body}=r;const changed={...body,...patch};const forged={...changed,fingerprint:snapshotSha(changed)};
 const m=createCouncilMemory();
 assert.throws(()=>companionReply(forged),/routing-not-advisory/);
 assert.throws(()=>recordCouncilOutcome(m,forged,{status:'succeeded',evidence:'receipt:fixture-scope'}),/routing-not-advisory/);
 assert.equal(m.outcomes().length,0);
});
