import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {CouncilAttestationVerifier} from '../src/security/council-verifier.js';

const NOW=Date.parse('2026-11-12T20:00:00Z');
const REPO='michaeljwilliams0123/Ultron.MW';
const MEMBERS=Array.from({length:7},(_,i)=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  return {id:'council-'+(i+1),privateKey,publicKeyPem:publicKey.export({type:'spki',format:'pem'})};
});
const intent=()=>({repo:REPO,operation:'pr.comment',
  planDigest:'a'.repeat(64),ownerGrantHash:'b'.repeat(64),
  nonce:'c'.repeat(32),expiresAt:NOW+30000,policyVersion:'v1'});
const signedBytes=i=>Buffer.from(JSON.stringify([
  'UUAM-COUNCIL-V1',i.repo,i.operation,i.planDigest,i.ownerGrantHash,
  i.nonce,i.expiresAt,i.policyVersion
]));
const votes=i=>MEMBERS.map(member=>({signerId:member.id,
  signature:sign(null,signedBytes(i),member.privateKey).toString('base64url')}));
const verifier=()=>new CouncilAttestationVerifier({members:MEMBERS,
  threshold:7,policyVersion:'v1',allowedOperations:['pr.comment']});

test('exact seven independent registered Ed25519 signers accept bound intent',()=>{
  const v=verifier(),i=intent();
  assert.equal(v.verifyConsensus(i,votes(i),NOW),true);
});
test('six signers cannot reach seven-member threshold',()=>{
  const i=intent();assert.equal(verifier().verifyConsensus(i,votes(i).slice(0,6),NOW),false);
});
test('duplicate, unknown and malformed votes cannot inflate quorum',()=>{
  const i=intent(),arr=votes(i);
  assert.equal(verifier().verifyConsensus(i,[...arr.slice(0,6),arr[0]],NOW),false);
  assert.equal(verifier().verifyConsensus(i,[...arr.slice(0,6),{...arr[6],signerId:'imposter'}],NOW),false);
  assert.equal(verifier().verifyConsensus(i,[...arr.slice(0,6),{...arr[6],signature:'not base64!!!'}],NOW),false);
});
test('signed plan does not authorize a changed repo, operation, digest or owner grant',()=>{
  const i=intent(),v=votes(i);
  for(const override of [
    {repo:'attacker/other'}, {operation:'repository.settings.update'},
    {planDigest:'d'.repeat(64)}, {ownerGrantHash:'e'.repeat(64)},
    {nonce:'d'.repeat(32)}, {policyVersion:'v2'}]){
    assert.equal(verifier().verifyConsensus({...i,...override},v,NOW),false);
  }
});
test('rejects expired or unreasonably distant grants',()=>{
  const i=intent(),v=votes(i);
  assert.equal(verifier().verifyConsensus(i,v,NOW+30001),false);
  assert.equal(verifier().verifyConsensus({...i,expiresAt:NOW+400000},v,NOW),false);
});
test('rejects duplicate signer keys at initialization',()=>{
  const members=MEMBERS.map(m=>({id:m.id,publicKeyPem:m.publicKeyPem}));
  members[1]={...members[1],publicKeyPem:members[0].publicKeyPem};
  assert.throws(()=>new CouncilAttestationVerifier({members,policyVersion:'v1',
    allowedOperations:['pr.comment']}),/duplicate/i);
});
test('rejects diminished threshold and unregistered algorithm',()=>{
  assert.throws(()=>new CouncilAttestationVerifier({members:MEMBERS,threshold:4,
    policyVersion:'v1',allowedOperations:['pr.comment']}),/threshold/i);
  const rsa=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey;
  assert.throws(()=>new CouncilAttestationVerifier({members:[
    {...MEMBERS[0],publicKeyPem:rsa.export({type:'spki',format:'pem'})}
  ],threshold:1,policyVersion:'v1',allowedOperations:['pr.comment']}),/ed25519/i);
});
test('rejects unsigned extra intent fields and missing registered authorization evidence',()=>{
  const i=intent(),v=votes(i);
  assert.equal(verifier().verifyConsensus({...i,untrustedOverride:true},v,NOW),false);
  assert.equal(verifier().verifyConsensus({...i,ownerGrantHash:null},v,NOW),false);
});
