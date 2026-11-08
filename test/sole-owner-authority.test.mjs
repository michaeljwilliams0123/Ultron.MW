import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {verifyDelegatedGrant} from '../cloud/hatchable/lib/security-adjudicator.js';
import {
 assertOperationAuthorization,evaluateProtectedHead,
 ULTRON_REPOSITORY
} from '../src/github-principal-policy.mjs';

const OWNER='michaeljwilliams0123';
const NOW='2026-11-08T14:00:00Z';
const SHA='b'.repeat(40);

test('the owner can issue a one-use cryptographically signed grant without an external co-signer',async()=>{
 const pair=await webcrypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const request={actor:'mcp:ultron',objectiveId:'solo-owner-test',
  operation:'repo.issue.create',resource:ULTRON_REPOSITORY,
  administrativeChange:false};
 const grant={schema:'ultron.security-grant.v1',
  issuer:'ultron-owner-authority',authorizedBy:OWNER,
  audience:'ultron-cloud-brain',grantId:'owner-signed-test-001',
  policySha:'a'.repeat(64),notBefore:'2026-11-08T13:59:00Z',
  expiresAt:'2026-11-08T14:03:00Z',...request};
 const publicJwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 const sign=async value=>{
  const payload=JSON.stringify(value);
  const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},
   pair.privateKey,new TextEncoder().encode(payload));
  return {payload,signature:Buffer.from(signature).toString('base64url')};
 };
 const verified=await verifyDelegatedGrant({envelope:await sign(grant),
  publicJwk,request,now:NOW,subtle:webcrypto.subtle});
 assert.equal(verified.authorizedBy,OWNER);
 assert.equal(verified.authorized,true);
 assert.equal('privateKey' in verified,false);
 await assert.rejects(verifyDelegatedGrant({
  envelope:await sign({...grant,authorizedBy:'untrusted-reviewer'}),
  publicJwk,request,now:NOW,subtle:webcrypto.subtle
 }),/invalid-grant-claims/);
});

test('standing and step-up grants use verified owner authority, not independent signers',()=>{
 const common={verified:true,actor:OWNER,repository:ULTRON_REPOSITORY,
  planDigest:'a'.repeat(64),idempotencyKey:'owner:test:0001',
  installationId:123,grantId:'owner-authorized-001',
  expiresAt:'2026-11-08T14:05:00Z'};
 const context={planDigest:common.planDigest,idempotencyKey:common.idempotencyKey,
  installationId:common.installationId,now:NOW};
 for(const [operation,source] of [
  ['repair.branch.update','owner-standing-authorization'],
  ['repository.settings.update','owner-step-up-authorization']
 ]){
  assert.equal(assertOperationAuthorization({...common,source,operation},
   {operation,...context}).grantId,common.grantId);
  assert.throws(()=>assertOperationAuthorization({...common,source,operation,
   actor:'someone-else'},{operation,...context}),/authorization/i);
 }
});

test('protected PR can pass on owner authorization and automated security evaluation alone',()=>{
 const ownerApproval={source:'github-owner-queue-attestation',verified:true,
  actor:OWNER,repository:ULTRON_REPOSITORY,issueNumber:209,
  commentId:12345,scope:'routine-source-squash',decision:'approved',
  approvedPrNumbers:[200]};
 const evidence={source:'github-protected-head-readback',verified:true,
  headSha:SHA,observedAt:'2026-11-08T13:59:30Z',
  checks:[{name:'test',status:'completed',conclusion:'success',headSha:SHA},
   {name:'fixed-comparison',status:'completed',conclusion:'success',headSha:SHA}],
  ownerApproval,githubRules:{source:'github-enforced-merge-readback',
   verified:true,eligible:true},dependenciesSatisfied:true,
  materialSecurityFindingsClear:true,criticalSecurityHold:true,
  securityEvaluation:{source:'trusted-automated-security-evaluation',
   verified:true,status:'cleared'}};
 const args={headSha:SHA,prNumber:200,principalActorRef:'github-app:ultron-operator',
  now:NOW};
 assert.equal(evaluateProtectedHead(evidence,args).ready,true);
 assert.equal(evaluateProtectedHead({...evidence,securityEvaluation:null},args).ready,false);
 assert.equal(evaluateProtectedHead({...evidence,ownerApproval:{
  ...ownerApproval,actor:'untrusted-user'}},args).ready,false);
});
