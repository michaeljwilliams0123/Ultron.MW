import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOwnerConfirmedPlanOnly} from '../src/providers/chatgpt-plan-only-policy.mjs';
import {readFileSync} from 'node:fs';

const now=Date.parse('2026-11-16T16:00:00Z');
const credential={
 kind:'chatgpt-plan-oauth',client_id:'oaiapp_ultron_council_12345',
 ext_agent_host_id:'urn:uuid:3c5e7c3a-29ce-4cbd-bc0c-1b904962b14d',
 subject:'owner-synthetic'
};
const confirmed={
 kind:'owner-confirmed-plan-only-settings',
 clientId:credential.client_id,hostId:credential.ext_agent_host_id,
 subject:credential.subject,appLimitPercent:95,appCreditsEnabled:false,
 confirmedAt:'2026-11-16T15:59:00Z'
};

test('local user-confirmed limit below 100 and app credits off permits synthetic plan canary',()=>{
 assert.equal(assertOwnerConfirmedPlanOnly(credential,confirmed,{now}),true);
});
test('missing or unverified usage setting always prevents model canary',()=>{
 for(const value of [undefined,null,{},false]){
  assert.throws(()=>assertOwnerConfirmedPlanOnly(credential,value,{now}),
    /plan-only-settings-not-confirmed/);
 }
});
test('100 percent app limit, credit use enabled, or unknown toggle never clears plan-only guard',()=>{
 for(const value of [
  {...confirmed,appLimitPercent:100},
  {...confirmed,appLimitPercent:0},
  {...confirmed,appLimitPercent:'95'},
  {...confirmed,appCreditsEnabled:true},
  {...confirmed,appCreditsEnabled:null},
  {...confirmed,appCreditsEnabled:'false'}
 ]){
  assert.throws(()=>assertOwnerConfirmedPlanOnly(credential,value,{now}));
 }
});
test('only same issuer registration, owner subject, host, and recent confirmation are accepted',()=>{
 for(const value of [
  {...confirmed,clientId:'oaiapp_other'},
  {...confirmed,hostId:'urn:uuid:00000000-0000-4000-8000-000000000000'},
  {...confirmed,subject:'other-user'},
  {...confirmed,confirmedAt:'2026-11-14T00:00:00Z'},
  {...confirmed,confirmedAt:'2026-11-16T17:00:00Z'},
  {...confirmed,kind:'automation-generated'},
 ]){
  assert.throws(()=>assertOwnerConfirmedPlanOnly(credential,value,{now}));
 }
});
test('operator CLI must enforce owner confirmation before sending a live inference request',()=>{
 const src=readFileSync(new URL('../scripts/chatgpt-plan-council.mjs',import.meta.url),'utf8');
 const branch=src.split("else if(cmd==='canary')")[1]??'';
 assert.match(branch,/assertOwnerConfirmedPlanOnly/);
 assert.match(branch,/reasonAsRole/);
 assert.ok(branch.indexOf('assertOwnerConfirmedPlanOnly')<branch.indexOf('reasonAsRole'));
});
