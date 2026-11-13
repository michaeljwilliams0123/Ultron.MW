/**
 * Sole-owner P-256 grant issuer. No co-signer, paid Vault or second account.
 * The owner alone controls the private key; only its public JWK reaches
 * Hatchable. Never commit a private key, paste it into a workflow or log it.
 */
import {webcrypto,randomUUID} from 'node:crypto';
import {readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {dirname,resolve,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyDelegatedGrant} from '../cloud/hatchable/lib/security-adjudicator.js';

const OWNER='michaeljwilliams0123';
const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url))).toLowerCase();
const SHA=/^[a-f0-9]{64}$/;
function privatePath(file){
 if(typeof file!=='string'||!isAbsolute(file))throw Error('private-key-path-required');
 const canonical=resolve(file).toLowerCase();
 if(canonical===ROOT||canonical.startsWith(ROOT+sep))
  throw Error('private-key-inside-repository');
 return resolve(file);
}
async function guardedFile(file){
 const path=privatePath(file);
 const canonical=(await realpath(path)).toLowerCase();
 if(canonical===ROOT||canonical.startsWith(ROOT+sep))
  throw Error('private-key-inside-repository');
 return path;
}
function validRequest(r){
 if(!r||typeof r!=='object'||Array.isArray(r))return false;
 const keys=Object.keys(r).sort().join(',');
 if(keys!=='actor,administrativeChange,objectiveId,operation,policySha,profileVersion,resource,stopVersion')
  return false;
 return ['actor','objectiveId','operation','resource'].every(k=>
   typeof r[k]==='string'&&r[k].length>0&&r[k].length<=256)&&
  typeof r.administrativeChange==='boolean'&&SHA.test(r.policySha)&&
  Number.isSafeInteger(r.profileVersion)&&r.profileVersion>0&&
  Number.isSafeInteger(r.stopVersion)&&r.stopVersion>0;
}
export async function generateOwnerKeyPair({privateFile,publicFile}={}){
 const target=privatePath(privateFile);
 if(typeof publicFile!=='string'||!isAbsolute(publicFile)||
   resolve(publicFile)===target)throw Error('public-key-path-required');
 // Validate the destination parent to prevent a symlink into this checkout.
 const parent=(await realpath(dirname(target))).toLowerCase();
 if(parent===ROOT||parent.startsWith(ROOT+sep))
  throw Error('private-key-inside-repository');
 const pair=await webcrypto.subtle.generateKey(
  {name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const privateJwk=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
 const publicJwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
 await writeFile(target,JSON.stringify(privateJwk),{flag:'wx',mode:0o600});
 try{
  await writeFile(publicFile,JSON.stringify(publicJwk),{flag:'wx',mode:0o600});
 }catch(error){await rm(target,{force:true});throw error;}
 return {privateFile:target,publicFile:resolve(publicFile)};
}
export async function signOwnerGrant({privateFile,request,now=Date.now()}={}){
 const path=await guardedFile(privateFile);
 if(!validRequest(request)||!Number.isSafeInteger(now)||
  !Number.isFinite(new Date(now).getTime()))
  throw Error('invalid-owner-grant-request');
 const key=JSON.parse(await readFile(path,'utf8'));
 if(key?.kty!=='EC'||key?.crv!=='P-256'||!key.d||
  typeof key.x!=='string'||typeof key.y!=='string')
  throw Error('owner-signing-key-invalid');
 const signingKey=await webcrypto.subtle.importKey('jwk',key,
  {name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const grant={
  schema:'ultron.security-grant.v1',issuer:'ultron-owner-authority',
  authorizedBy:OWNER,audience:'ultron-cloud-brain',
  grantId:'owner-'+randomUUID(),policySha:request.policySha,
  notBefore:new Date(now-1000).toISOString(),
  // The PR-comment verifier caps total validity at five minutes including
  // the backdated notBefore second. Leave a margin for clock drift.
  expiresAt:new Date(now+4*60_000).toISOString(),
  actor:request.actor,objectiveId:request.objectiveId,
  operation:request.operation,resource:request.resource,
  administrativeChange:request.administrativeChange,
  profileVersion:request.profileVersion,stopVersion:request.stopVersion
 };
 const payload=JSON.stringify(grant);
 const signature=await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},
  signingKey,new TextEncoder().encode(payload));
 const envelope={payload,signature:Buffer.from(signature).toString('base64url')};
 await verifyDelegatedGrant({envelope,
  publicJwk:{kty:'EC',crv:'P-256',x:key.x,y:key.y},
  request:{actor:request.actor,objectiveId:request.objectiveId,
   operation:request.operation,resource:request.resource,
   administrativeChange:request.administrativeChange},
  now:new Date(now).toISOString(),subtle:webcrypto.subtle
 });
 return envelope;
}
async function main(){
 const [command,a,b,c]=process.argv.slice(2);
 if(command==='init'&&a&&b){
  const result=await generateOwnerKeyPair({privateFile:a,publicFile:b});
  console.log(JSON.stringify(result));
 }else if(command==='sign'&&a&&b){
  const request=JSON.parse(await readFile(b,'utf8'));
  const envelope=await signOwnerGrant({privateFile:a,request});
  if(c)await writeFile(c,JSON.stringify(envelope),{flag:'wx',mode:0o600});
  else console.log(JSON.stringify(envelope));
 }else{
  throw Error('usage: owner-grant.mjs init PRIVATE_JWK PUBLIC_JWK | sign PRIVATE_JWK REQUEST_JSON [ENVELOPE_JSON]');
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
