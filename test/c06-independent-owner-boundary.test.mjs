import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateC06OwnerEffect} from '../lib/c06-owner-safe.mjs';

// Independently authored acceptance cases, not model-generated training vectors.
const valid={authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true};
test('C06 independent: explicit authorized observed receipt is verified',()=>{
 assert.equal(evaluateC06OwnerEffect(valid),'verified');
});
test('C06 independent: stopped, unauthorized or nonzero spend always holds',()=>{
 for(const patch of [{paused:true},{authorized:false},{paidCents:1},{paidCents:-1},{paidCents:0.5}]){
  assert.equal(evaluateC06OwnerEffect({...valid,...patch}),'held');
 }
});
test('C06 independent: unknown or timed-out provider result requires reconciliation',()=>{
 for(const status of ['unknown','timeout']){
  assert.equal(evaluateC06OwnerEffect({...valid,providerStatus:status,receiptVerified:false}),'reconcile');
 }
});
test('C06 independent: unverifiable or unsupported provider result never claims verification',()=>{
 for(const status of ['observed','success','error','',null,0,{}]){
  assert.equal(evaluateC06OwnerEffect({...valid,providerStatus:status,receiptVerified:false}),'held');
 }
});
test('C06 independent: inherited authority, accessor traps, arrays and exotic inputs fail closed',()=>{
 const inherited=Object.create(valid);
 assert.equal(evaluateC06OwnerEffect(inherited),'held');
 let getterCalled=false;
 const accessor=Object.create(null,{
  authorized:{get(){getterCalled=true;return true;},enumerable:true}
 });
 assert.equal(evaluateC06OwnerEffect(accessor),'held');
 assert.equal(getterCalled,false);
 for(const x of [null,undefined,[],new Date(),1,'test',Object.freeze({}),{...valid,extra:'write'}])
  assert.equal(evaluateC06OwnerEffect(x),'held');
});
test('C06 independent: supplied status cannot smuggle an external write',()=>{
 for(const x of [
  {...valid,providerStatus:'observed',receiptVerified:'true'},
  {...valid,providerStatus:'unknown',receiptVerified:true,operation:'merge'},
  {...valid,authorized:'true'},
  {...valid,paused:0},
 ]){
  assert.equal(evaluateC06OwnerEffect(x),'held');
 }
});
