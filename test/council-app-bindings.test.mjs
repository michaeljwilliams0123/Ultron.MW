import test from 'node:test';
import assert from 'node:assert/strict';
import {
 COUNCIL_COORDINATOR_APP_ID,councilAppBindingBlueprints,resolveCouncilAppIdentity,
 resolveReceiptAppIdentity
} from '../src/council-app-bindings.mjs';

test('Coordinator is a distinct App identity, not a widened Council role',()=>{
 assert.equal(COUNCIL_COORDINATOR_APP_ID,5633654);
 const identity=resolveCouncilAppIdentity({
  role:'Builder',appId:5633654,appSlug:'ultron-mw-builder-v2'
 });
 assert.deepEqual({
  role:identity.role,appId:identity.appId,appSlug:identity.appSlug,
  botLogin:identity.botLogin,kind:identity.kind,independentReview:identity.independentReview
 },{
  role:'Builder',appId:5633654,appSlug:'ultron-mw-builder-v2',
  botLogin:'ultron-mw-builder-v2[bot]',kind:'coordinator',independentReview:false
 });
});

test('known App ID cannot be paired with an impostor slug or login',()=>{
 assert.throws(()=>resolveCouncilAppIdentity({
  role:'Builder',appId:5633654,appSlug:'ultron-mw-builder'
 }),/identity-mismatch/);
 assert.throws(()=>resolveCouncilAppIdentity({
  role:'Builder',appId:999,appSlug:'ultron-mw-builder-v2'
 }),/identity-mismatch/);
 assert.throws(()=>resolveReceiptAppIdentity({
  role:'Builder',appId:5633654,appSlug:'ultron-mw-builder'
 }),/identity-mismatch/);
 assert.throws(()=>resolveCouncilAppIdentity({
  role:'Skeptic',appId:5633654,appSlug:'ultron-mw-skeptic',expectedAppId:5633654
 }),/identity-mismatch/);
});

test('unregistered member blueprints require a separately trusted expected App ID',()=>{
 const [builder]=councilAppBindingBlueprints('Builder');
 assert.equal(builder.appSlug,'ultron-mw-builder');
 assert.equal(builder.appId,null);
 assert.throws(()=>resolveCouncilAppIdentity({
  role:'Builder',appId:44,appSlug:'ultron-mw-builder'
 }),/identity-mismatch/);
 assert.equal(resolveCouncilAppIdentity({
  role:'Builder',appId:44,appSlug:'ultron-mw-builder',expectedAppId:44
 }).bindingKey,'council-member');
 assert.throws(()=>resolveCouncilAppIdentity({
  role:'Builder',appId:44,appSlug:'ultron-mw-builder',expectedAppId:45
 }),/identity-mismatch/);
});
