import test from 'node:test';
import assert from 'node:assert/strict';
import { resumePendingMahoragaActions } from '../cloud/hatchable/lib/mahoraga-actions.js';

test('hourly recovery selects only existing admitted actions and preserves identity',async()=>{
 const seen=[],calls=[];
 const db={async query(sql,params){
   calls.push({sql,params});
   return {rows:[
     {action_key:'ultron:issue95-canary-20261024',operation:'issue.create',
      request:{title:'Canary',body:'Acceptance',expectedMainSha:'a'.repeat(40)}},
     {action_key:'ultron:dispatch-verify-20261024',operation:'verify.dispatch',
      request:{ref:'mahoraga/verify',expectedHeadSha:'b'.repeat(40)}}]};
 }};
 const execute=async(_runtime,action)=>{
   seen.push(action);
   return {ok:true,state:action.operation==='issue.create'?'observed':'uncertain'};
 };
 const result=await resumePendingMahoragaActions({db,config:{},execute,limit:2});
 assert.equal(result.scanned,2);
 assert.equal(result.observed,1);
 assert.equal(result.pending,1);
 assert.deepEqual(seen.map(x=>x.key),
   ['ultron:issue95-canary-20261024','ultron:dispatch-verify-20261024']);
 assert.match(calls[0].sql,/state IN \('prepared','sent','uncertain'\)/);
 assert.match(calls[0].sql,/ORDER BY id ASC LIMIT \$1/);
 assert.deepEqual(calls[0].params,[2]);
 assert.equal(JSON.stringify(result).includes('Acceptance'),false);
});

test('hourly recovery cannot invent work when no persisted action exists',async()=>{
 let executed=false;
 const result=await resumePendingMahoragaActions({
   db:{query:async()=>({rows:[]})},config:{},
   execute:async()=>{executed=true;}
 });
 assert.equal(executed,false);
 assert.deepEqual(result,{scanned:0,observed:0,pending:0,outcomes:[]});
});

test('hourly recovery holds errors instead of claiming success or leaking responses',async()=>{
 const result=await resumePendingMahoragaActions({
   db:{query:async()=>({rows:[{action_key:'ultron:one1234',
     operation:'issue.create',request:{title:'x'}}]})},
   config:{},execute:async()=>{throw Error('private response contents must not escape');}
 });
 assert.deepEqual(result.outcomes,[{state:'unavailable',ok:false}]);
 assert.equal(result.pending,1);
 assert.doesNotMatch(JSON.stringify(result),/private response contents/);
});

test('hourly recovery rejects invalid limits and overlong provider snapshots',async()=>{
 for(const limit of [0,-1,5,1.5]){
   await assert.rejects(resumePendingMahoragaActions({db:{},limit}),/invalid-mahoraga-resume-limit/);
 }
 await assert.rejects(resumePendingMahoragaActions({
   db:{query:async()=>({rows:[{},{}]})},limit:1,
 }),/invalid-mahoraga-resume-snapshot/);
});
