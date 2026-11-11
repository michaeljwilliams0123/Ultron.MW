import test from 'node:test';
import assert from 'node:assert/strict';
import {isCouncilOwnerInitiated} from '../src/council-owner-delegation.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const secondary={id:354634860,login:'michaeljwilliams0123ultron'};
const source={id:1424939667,full_name:REPO};
const pr={user:secondary,head:{repo:source,sha:'a'.repeat(40)},
 base:{repo:source,ref:'main'}};
test('primary owner authentic actor is owner-initiated',()=>{
 assert.equal(isCouncilOwnerInitiated({eventName:'pull_request',
   actor:'michaeljwilliams0123',repository:REPO,pr}),true);
});
test('approved secondary user identity on canonical same-repo PR counts as owner-initiated, not override',()=>{
 assert.equal(isCouncilOwnerInitiated({eventName:'pull_request',
   actor:'michaeljwilliams0123ultron',repository:REPO,pr}),true);
});
test('numeric ID, login, actor, repo ID, full name and main target must all match',()=>{
 const base={eventName:'pull_request',actor:'michaeljwilliams0123ultron',
   repository:REPO,pr};
 for(const bad of [
  {...base,actor:'third-party'},
  {...base,pr:{...pr,user:{...secondary,id:1}}},
  {...base,pr:{...pr,user:{...secondary,login:'attacker'}}},
  {...base,pr:{...pr,head:{...pr.head,repo:{...source,id:999}}}},
  {...base,pr:{...pr,head:{...pr.head,repo:{...source,full_name:'evil/Ultron.MW'}}}},
  {...base,pr:{...pr,base:{...pr.base,repo:{...source,id:777}}}},
  {...base,pr:{...pr,base:{...pr.base,ref:'other'}}},
  {...base,repository:'other/Ultron.MW'},
  {...base,eventName:'workflow_dispatch'},
  {...base,pr:{...pr,head:{...pr.head,sha:'bad'}}}
 ])assert.equal(isCouncilOwnerInitiated(bad),false);
});
test('secondary alone cannot turn an issue, foreign PR or spoofed owner actor into owner mode',()=>{
 assert.equal(isCouncilOwnerInitiated({eventName:'issues',
  actor:'michaeljwilliams0123ultron',repository:REPO,pr}),false);
 assert.equal(isCouncilOwnerInitiated({eventName:'pull_request',
  actor:'michaeljwilliams0123',repository:'attacker/Ultron.MW',pr}),false);
});
