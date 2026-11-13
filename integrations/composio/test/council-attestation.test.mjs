import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as ed25519Sign,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {
 createTrustedComposioCouncilVerifier,councilAttestationSigningBytes,
 isTrustedComposioCouncilVerifier,createPostgresComposioCouncilNonceStore,
} from '../../../src/security/composio-council-attestation.mjs';
import {executeGovernedGitHubAppMutation} from '../index.mjs';
import {createComposioDurableAppExecutor} from '../durable-readback.mjs';

const HEAD='a'.repeat(40),PR=442,NOW=1794520000000;
const KID='council-release-main';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const {publicKey:foreignPublicKey,privateKey:foreignPrivate}=generateKeyPairSync('ed25519');
let counter=0;
function fixture({signer=privateKey,extras={}}={}){
 const nonce='council-verified-'+String(++counter).padStart(18,'0');
 const base={
  schema:'ultron.composio.council-attestation.v1',
  keyId:KID,sourceSha:HEAD,prNumber:PR,
  issuedAt:NOW-1000,expiresAt:NOW+240000,nonce,
  result:{status:'accepted',approvedCount:7,securitySensitive:false,
   sourceSha:HEAD,prNumber:PR},...extras,
 };
 const bytes=councilAttestationSigningBytes({...base,signature:'A'.repeat(86)});
 const signature=ed25519Sign(null,bytes,signer).toString('base64url');
 return {...base,signature};
}
function store(){
 const consumed=new Set();
 return {
  consumed,
  async consume({keyId,nonce,sourceSha,prNumber}){
   const k=[keyId,nonce,sourceSha,prNumber].join(':');
   if(consumed.has(k))return false;
   consumed.add(k);return true;
  },
 };
}
function verifier({keys={[KID]:publicKey},nonceStore=store(),clock=()=>NOW}={}){
 return createTrustedComposioCouncilVerifier({keys,nonceStore,clock});
}

test('rejects an unsigned Council verdict, a caller-crafted boolean or unbranded verifier',async()=>{
 let writes=0,tokens=0;
 const bogusVerdict={status:'accepted',approvedCount:7,securitySensitive:false,
  sourceSha:HEAD,prNumber:PR};
 const args={sha:HEAD,prNumber:PR,councilResult:bogusVerdict,
  operationRequest:{},tokenFactory:{getTokenForScope:async()=>tokens++},
  durableAppExecutor:async()=>{writes++;},
  trusted:{verifyCouncilAttestation:async()=>bogusVerdict}};
 await assert.rejects(executeGovernedGitHubAppMutation(args),
  /trusted Council attestation verifier required/);
 assert.equal(writes,0);assert.equal(tokens,0);
});
test('accepts a genuine short-lived Council signature exactly once',async()=>{
 const nonceStore=store(),v=verifier({nonceStore});
 assert.equal(isTrustedComposioCouncilVerifier(v),true);
 const envelope=fixture();
 const result=await v(envelope,{sourceSha:HEAD,prNumber:PR});
 assert.equal(result.status,'accepted');
 assert.equal(result.sourceSha,HEAD);
 assert.equal(nonceStore.consumed.size,1);
 await assert.rejects(v(envelope,{sourceSha:HEAD,prNumber:PR}),/nonce already used/);
});
test('rejects foreign signer, changed signature and unpinned key without nonce consumption',async()=>{
 const nonceStore=store(),v=verifier({nonceStore});
 await assert.rejects(v(fixture({signer:foreignPrivate}),{sourceSha:HEAD,prNumber:PR}),
  /signature invalid/);
 const envelope=fixture(),changed={...envelope,expiresAt:envelope.expiresAt-1000};
 await assert.rejects(v(changed,{sourceSha:HEAD,prNumber:PR}),/signature invalid/);
 await assert.rejects(v({...envelope,keyId:'council-unpinned-key'},
  {sourceSha:HEAD,prNumber:PR}),/signer not pinned/);
 assert.equal(nonceStore.consumed.size,0);
});
test('rejects the wrong PR number or source SHA before consuming a nonce',async()=>{
 const nonceStore=store(),v=verifier({nonceStore}),envelope=fixture();
 await assert.rejects(v(envelope,{sourceSha:'b'.repeat(40),prNumber:PR}),/binding mismatch/);
 await assert.rejects(v(envelope,{sourceSha:HEAD,prNumber:PR+1}),/binding mismatch/);
 assert.equal(nonceStore.consumed.size,0);
});
test('rejects an expired, future or excessively long attestation',async()=>{
 const v=verifier();
 await assert.rejects(v(fixture({extras:{
  issuedAt:NOW-300000,expiresAt:NOW-1000,
 }}),{sourceSha:HEAD,prNumber:PR}),/expired/);
 await assert.rejects(v(fixture({extras:{
  issuedAt:NOW+70000,expiresAt:NOW+120000,
 }}),{sourceSha:HEAD,prNumber:PR}),/future dated/);
 assert.throws(()=>fixture({extras:{issuedAt:NOW,expiresAt:NOW+1000000}}),/invalid attestation/);
});
test('a cryptographic Council signature cannot approve 6/7, owner override, or security-sensitive changes',()=>{
 for(const update of [
  {status:'accepted',approvedCount:6,securitySensitive:false},
  {status:'owner-overridden',approvedCount:7,securitySensitive:false},
  {status:'accepted',approvedCount:7,securitySensitive:true},
 ]){
  assert.throws(()=>fixture({extras:{result:{...update,sourceSha:HEAD,prNumber:PR}}}),
   /decision is not the seven-role/);
 }
});
test('an untrusted or unavailable durable nonce store cannot promote a result',async()=>{
 assert.throws(()=>createTrustedComposioCouncilVerifier({
  keys:{[KID]:publicKey},clock:()=>NOW
 }),/durable nonce store required/);
 const v=verifier({nonceStore:{consume:async()=>{throw Error('DB disconnected')}}});
 await assert.rejects(v(fixture(),{sourceSha:HEAD,prNumber:PR}),/nonce consumption unavailable/);
});
test('valid Council attestation alone cannot bypass missing owner operation signature',async()=>{
 let tokens=0,writes=0;
 const signed=fixture(),v=verifier();
 await assert.rejects(executeGovernedGitHubAppMutation({
  sha:HEAD,prNumber:PR,councilAttestation:signed,
  trusted:{verifyCouncilAttestation:v,db:{query:async()=>({rows:[]})},
    expectedInstallationId:1,clock:()=>NOW},
  operationRequest:{},
  tokenFactory:{getTokenForScope:async()=>{tokens++;}},
  durableAppExecutor:createComposioDurableAppExecutor({
   services:{db:{query:async()=>({rows:[]})},
    authorization:{verify:async()=>{throw Error('should not authorize');}},
    fetchImpl:async()=>({ok:false,status:404})},
   gitOperation:async()=>{writes++;},
  }),
 }),/Task 2 Security Error/);
 assert.equal(tokens,0);assert.equal(writes,0);
});
test('malformed envelope fields or invalid key types are rejected before provider execution',()=>{
 assert.throws(()=>createTrustedComposioCouncilVerifier({
  keys:{[KID]:foreignPrivate},nonceStore:store(),clock:()=>NOW,
 }),/untrusted Council public key/);
 const e=fixture();
 assert.throws(()=>councilAttestationSigningBytes({...e,token:'secret'}),/invalid attestation envelope/);
});

test('PostgreSQL atomically consumes the Council nonce across store reinitialization',async()=>{
 const db=new PGlite();
 try{
  const path=new URL('../../../cloud/hatchable/migrations/0037_github_approval_nonces.sql',import.meta.url);
  await db.exec(await readFile(path,'utf8'));
  const at=Date.now(),nonce='council-db-'+randomUUID().replace(/-/g,'');
  const request={keyId:KID,nonce,sourceSha:HEAD,prNumber:PR,
   issuedAt:at,expiresAt:at+240000};
  const first=createPostgresComposioCouncilNonceStore({db});
  const restarted=createPostgresComposioCouncilNonceStore({db});
  assert.equal(await first.consume(request),true);
  assert.equal(await restarted.consume(request),false);
  const {rows}=await db.query(
   'SELECT operation,target_resource,nonce FROM brain_github_approval_nonces WHERE nonce=$1',
   [nonce]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].operation,'ultron.composio.council-attestation.v1');
  assert.equal(rows[0].nonce,nonce);
  assert.ok(rows[0].target_resource.includes(HEAD));
  assert.ok(rows[0].target_resource.includes(String(PR)));
  // Two concurrent consumers of a fresh nonce must yield exactly one winner.
  // This is the same atomic unique-key primitive needed for duplicate webhook
  // or racing worker deliveries; it is not an external business effect.
  const secondNonce='council-db-'+randomUUID().replace(/-/g,'');
  const concurrentRequest={...request,nonce:secondNonce};
  const outcomes=await Promise.all([
   first.consume(concurrentRequest),restarted.consume(concurrentRequest)
  ]);
  assert.deepEqual(outcomes.sort(),[false,true]);
  const concurrent=await db.query(
   'SELECT count(*)::int AS count FROM brain_github_approval_nonces WHERE nonce=$1',
   [secondNonce]);
  assert.equal(concurrent.rows[0].count,1);
 }finally{await db.close();}
});
