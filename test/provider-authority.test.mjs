import test from 'node:test';
import assert from 'node:assert/strict';
import {providerAuthorizationPlan,supportedProviders} from '../src/provider-authority.mjs';
test('readiness contract never discloses provider credentials',()=>{
  assert.deepEqual(supportedProviders(),['github','datadog','huggingface']);
  const p=providerAuthorizationPlan('datadog',{env:{}});
  assert.equal(p.status,'requires-owner-authorization');
  assert.equal(p.reference,'ULTRON_DATADOG_API_KEY');
  assert.equal(p.credentialValue,null);
});
test('environment presence does not prove Datadog access or ingestion',()=>{
  const p=providerAuthorizationPlan('datadog',{
    env:{ULTRON_DATADOG_API_KEY:'a'.repeat(40),ULTRON_ENABLE_DATADOG:'1'}});
  assert.equal(p.status,'configured-not-verified');
  assert.equal(p.credentialValue,null);
});
test('local Hugging Face and GitHub workflow identity remain distinct',()=>{
  assert.equal(providerAuthorizationPlan('github').status,'workflow-identity');
  assert.equal(providerAuthorizationPlan('huggingface').status,'local-public');
  assert.throws(()=>providerAuthorizationPlan('unknown'),/Unsupported/);
});
