import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBandwidthAction } from '../cloudflare/edge-shield/src/bandwidth-policy.ts';
const t=Date.parse('2026-11-27T12:00:00Z');
const apply=(s,a,now=t)=>applyBandwidthAction(s,a,now);
test('provider reading at 400 MB blocks background release checks, preserving 100 MB',()=>{
 const s=apply(null,{kind:'observe',day:'2026-11-27',bytes:400_000_000}).state;
 const r=apply(s,{kind:'admit'});
 assert.equal(r.result.allowed,false);assert.equal(r.result.reason,'conservation-threshold');
 assert.equal(r.result.targetBytes,400_000_000);assert.equal(r.result.reserveBytes,100_000_000);
});
test('unknown usage is not represented as provider measured bytes',()=>{
 const r=apply(null,{kind:'admit'});
 assert.equal(r.result.allowed,true);assert.equal(r.result.providerBytes,null);
 assert.equal(r.result.estimatedBytes,2_000_000);
});
test('reservation cannot cross the operating threshold',()=>{
 const s=apply(null,{kind:'observe',day:'2026-11-27',bytes:399_000_000}).state;
 assert.equal(apply(s,{kind:'admit'}).result.allowed,false);
});
test('concurrent admission is paced and bounded per UTC day',()=>{
 let s=apply(null,{kind:'admit'}).state;
 assert.equal(apply(s,{kind:'admit'},t+1000).result.reason,'paced');
 for(let i=1;i<24;i++)s=apply(s,{kind:'admit'},t+i*600_000).state;
 assert.equal(apply(s,{kind:'admit'},t+24*600_000).result.reason,'daily-verification-limit');
});
test('provider quota hold survives all same-day admissions and resets at UTC midnight',()=>{
 const s=apply(null,{kind:'quota-hold',day:'2026-11-27'}).state;
 assert.equal(apply(s,{kind:'admit'},t+10_000).result.reason,'provider-quota-hold');
 const r=apply(s,{kind:'admit'},Date.parse('2026-11-28T00:00:00Z'));
 assert.equal(r.result.allowed,true);assert.equal(r.result.providerBytes,null);
});
test('stale-day and decreasing provider readings cannot clear a hold or reduce the estimate',()=>{
 let s=apply(null,{kind:'observe',day:'2026-11-27',bytes:390_000_000}).state;
 let r=apply(s,{kind:'observe',day:'2026-11-26',bytes:1});assert.equal(r.result.accepted,false);
 r=apply(s,{kind:'observe',day:'2026-11-27',bytes:100});assert.equal(r.result.accepted,false);
 assert.equal(r.state.estimatedBytes,390_000_000);
});
test('conservation pacing increases as measured bandwidth rises',()=>{
 let s=apply(null,{kind:'observe',day:'2026-11-27',bytes:375_000_000}).state;
 s=apply(s,{kind:'admit'}).state;
 assert.equal(apply(s,{kind:'admit'},t+30*60_000).result.reason,'paced');
});
test('prior-day quota response cannot open the new UTC day circuit',()=>{
 const s=apply(null,{kind:'admit'},Date.parse('2026-11-27T23:59:59Z')).state;
 const next=apply(s,{kind:'quota-hold',day:s.day},Date.parse('2026-11-28T00:00:01Z'));
 assert.equal(next.result.accepted,false);
 assert.equal(next.state.quotaHold,false);
 assert.equal(apply(next.state,{kind:'admit'},Date.parse('2026-11-28T00:00:02Z')).result.allowed,true);
});
test('quota hold without a valid admission day is rejected',()=>{
 const r=apply(null,{kind:'quota-hold'});
 assert.equal(r.result.accepted,false); assert.equal(r.state.quotaHold,false);
});
