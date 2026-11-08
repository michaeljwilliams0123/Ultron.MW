import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {verifyDelegatedGrant} from '../cloud/hatchable/lib/security-adjudicator.js';
import {generateOwnerKeyPair,signOwnerGrant} from '../scripts/owner-grant.mjs';

const request={
 actor:'mcp:ultron',objectiveId:'owner-branch-canary',
 operation:'repo.issue.create',resource:'michaeljwilliams0123/Ultron.MW',
 administrativeChange:false,policySha:'a'.repeat(64),
 profileVersion:5,stopVersion:5
};

test('owner alone generates an outside-repository key and signs one bounded grant',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ultron-owner-key-'));
 try{
  const privateFile=join(dir,'owner-private.jwk');
  const publicFile=join(dir,'owner-public.jwk');
  await generateOwnerKeyPair({privateFile,publicFile});
  const keyText=await readFile(privateFile,'utf8');
  const publicJwk=JSON.parse(await readFile(publicFile,'utf8'));
  assert.equal(JSON.parse(keyText).kty,'EC');
  assert.equal('d' in publicJwk,false,'public verifier does not contain private key');
  const now=Date.UTC(2026,10,8,14,0);
  const envelope=await signOwnerGrant({privateFile,request,now});
  assert.equal(typeof envelope.signature,'string');
  assert.equal(envelope.signature.length,86);
  assert.equal(JSON.stringify(envelope).includes(JSON.parse(keyText).d),false,
   'private scalar must never appear in output');
  const result=await verifyDelegatedGrant({
   envelope,publicJwk,request,now:new Date(now).toISOString(),subtle:webcrypto.subtle
  });
  assert.equal(result.authorizedBy,'michaeljwilliams0123');
  assert.equal(result.operation,request.operation);
  assert.equal(result.resource,request.resource);
  assert.equal(result.authorized,true);
  const changed={...envelope,payload:envelope.payload.replace('owner-branch-canary','different-branch')};
  await assert.rejects(verifyDelegatedGrant({envelope:changed,publicJwk,request,
   now:new Date(now).toISOString(),subtle:webcrypto.subtle}),/invalid-grant-signature/);
  await assert.rejects(signOwnerGrant({privateFile,request:{...request,profileVersion:0},now}),
   /invalid-owner-grant-request/);
  await assert.rejects(generateOwnerKeyPair({privateFile,publicFile}),/EEXIST/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('owner key creation refuses a private key inside checked-in source',async()=>{
 const keyFile=new URL('../test/forbidden-private-key.jwk',import.meta.url);
 await assert.rejects(generateOwnerKeyPair({
  privateFile:fileURLToPath(keyFile),publicFile:fileURLToPath(keyFile)+'.public'
 }),/private-key-inside-repository/);
});
