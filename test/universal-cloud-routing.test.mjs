import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUniversalCloudCommand} from
  '../cloud/hatchable/lib/universal-cloud-routing.js';

const input={provider:'gitlab',mode:'prepare',estimatedCostCents:0,
  request:{key:'task-0001',sourceSha:'a'.repeat(40),
    expectedProfileVersion:3,expectedStopVersion:5}};
test('universal entry recognizes only certified external provider operations',()=>{
  const admitted=normalizeUniversalCloudCommand(input);
  assert.equal(admitted.ok,true);
  assert.equal(admitted.operation,'gitlab.branch.create');
  for(const provider of ['hatchable-browser','composio','huggingface','github','unknown']){
    const denied=normalizeUniversalCloudCommand({...input,provider});
    assert.equal(denied.ok,false);
  }
});
test('unknown or nonzero cost and caller-provided authority flags fail closed',()=>{
  for(const inputPatch of [
    {estimatedCostCents:undefined},{estimatedCostCents:1},
    {verified:true},{ownerGrant:{verified:true}},
  ])assert.equal(normalizeUniversalCloudCommand({...input,...inputPatch}).ok,false);
});
test('submit requires a structurally valid signed owner proof; reconcile requires grant ID',()=>{
  const denied=normalizeUniversalCloudCommand({...input,mode:'submit'});
  assert.equal(denied.ok,false);
  const admitted=normalizeUniversalCloudCommand({...input,mode:'submit',
    envelope:{payload:'valid-owner-claim',signature:'a'.repeat(86)}});
  assert.equal(admitted.ok,true);
  assert.equal(admitted.operation,'gitlab.branch.create');
  assert.equal(normalizeUniversalCloudCommand({...input,mode:'reconcile'}).ok,false);
  assert.equal(normalizeUniversalCloudCommand({...input,mode:'reconcile',
    grantId:'grant-id-00000001'}).ok,true);
});
test('passkey proof is available only for the existing GitLab owner-verifier path',()=>{
  const proof={grantId:'passkey-abcabcabcabcabcabc',credentialId:'a'.repeat(20),
    authenticatorData:'b'.repeat(20),clientDataJSON:'c'.repeat(20),
    signature:'d'.repeat(20)};
  assert.equal(normalizeUniversalCloudCommand({
    ...input,mode:'submit',passkey:proof,
  }).ok,true);
  assert.equal(normalizeUniversalCloudCommand({
    ...input,provider:'graph',mode:'submit',passkey:proof,
  }).ok,false);
});
test('config-driven adapter disable, rollback, and malformed config fail closed',()=>{
  const disabled=normalizeUniversalCloudCommand(input,{
    adapterConfigRaw:JSON.stringify({gitlab:{enabled:false,version:'v1.2.0'}}),
  });
  assert.equal(disabled.ok,false);
  assert.equal(disabled.reason,'adapter-disabled-by-config');
  const rolledBack=normalizeUniversalCloudCommand(input,{
    adapterConfigRaw:JSON.stringify({gitlab:{enabled:true,version:'v1.2.0',rollbackTo:'v1.1.0'}}),
  });
  assert.equal(rolledBack.ok,true);
  assert.equal(rolledBack.adapterVersion,'v1.1.0');
  assert.equal(rolledBack.rolledBack,true);
  for(const bad of ['{bad-json',JSON.stringify({gitlab:{maxCostCents:1}}),JSON.stringify([])]){
    const denied=normalizeUniversalCloudCommand(input,{adapterConfigRaw:bad});
    assert.equal(denied.ok,false);
    assert.equal(denied.reason,'adapter-registry-config-invalid');
  }
});
test('operation-specific authorization and payload resource limits fail closed',()=>{
  const opDenied=normalizeUniversalCloudCommand(input,{
    adapterConfigRaw:JSON.stringify({gitlab:{enabled:true,allowedOperations:['gitlab.issue.read']}}),
  });
  assert.equal(opDenied.ok,false);
  assert.equal(opDenied.reason,'operation-disabled-by-config');
  const protoReq=JSON.parse('{"__proto__":{"admin":true},"key":"task-0001"}');
  const protoDenied=normalizeUniversalCloudCommand({...input,request:protoReq});
  assert.equal(protoDenied.ok,false);
  assert.equal(protoDenied.reason,'unsafe-request-key');
  const oversized=normalizeUniversalCloudCommand({
    ...input,
    request:{key:'task-0001',blob:'x'.repeat(17000)},
  });
  assert.equal(oversized.ok,false);
  assert.equal(oversized.reason,'request-resource-limit-exceeded');
});
