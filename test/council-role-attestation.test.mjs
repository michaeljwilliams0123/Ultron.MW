import test from 'node:test';
import assert from 'node:assert/strict';
import {signCouncilRoleVerdict,verifyCouncilRoleVerdict,deriveCouncilRolePublicKeys} from '../src/council-role-attestation.mjs';

const root='a5'.repeat(32);
const sha='b'.repeat(40);
const verdict={role:'Skeptic',prNumber:460,sourceSha:sha,verdict:'hold',
 confidence:0.92,source:'model',inputDigest:'c'.repeat(64),
 rationale:'src/handler.mjs may replay a denied write',findings:['verify provider readback']};

test('seven domain-separated Ed25519 role keys are unique and signatures verify against pinned public keys',()=>{
 const keys=deriveCouncilRolePublicKeys(root);
 assert.equal(Object.keys(keys).length,7);
 assert.equal(new Set(Object.values(keys)).size,7);
 const signed=signCouncilRoleVerdict(verdict,root);
 assert.equal(signed.attestation.algorithm,'Ed25519');
 assert.equal(signed.attestation.independentGithubReview,false);
 assert.equal(verifyCouncilRoleVerdict(signed,{trustedPublicKeys:keys,expectedSha:sha,expectedPr:460}),true);
});
test('tampered role, verdict, PR head or an untrusted self-issued public key cannot validate',()=>{
 const keys=deriveCouncilRolePublicKeys(root),signed=signCouncilRoleVerdict(verdict,root);
 assert.equal(verifyCouncilRoleVerdict({...signed,verdict:'proceed'},{trustedPublicKeys:keys,expectedSha:sha,expectedPr:460}),false);
 assert.equal(verifyCouncilRoleVerdict({...signed,role:'Builder'},{trustedPublicKeys:keys,expectedSha:sha,expectedPr:460}),false);
 assert.equal(verifyCouncilRoleVerdict(signed,{trustedPublicKeys:keys,expectedSha:'d'.repeat(40),expectedPr:460}),false);
 assert.equal(verifyCouncilRoleVerdict(signed,{trustedPublicKeys:{},expectedSha:sha,expectedPr:460}),false);
});
test('missing/weak seed and unsupported role fail closed',()=>{
 assert.throws(()=>deriveCouncilRolePublicKeys('bad'),/root-seed-invalid/);
 assert.throws(()=>signCouncilRoleVerdict({...verdict,role:'NotCouncil'},root),/role-invalid/);
 assert.throws(()=>signCouncilRoleVerdict({...verdict,sourceSha:''},root),/source-sha-invalid/);
});
