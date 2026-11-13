/**
 * Authentication boundary for Council decisions used by the Composio App bridge.
 *
 * An advisory vote, an unsigned verdict object, or an untrusted boolean is NOT
 * evidence. This verifier accepts a short-lived Ed25519 attestation from a
 * separately pinned Council public key and consumes its nonce durably before
 * allowing the trusted GitHub App executor to proceed.
 *
 * Production MUST supply a real atomic PostgreSQL nonce consumer. This
 * module deliberately does not register keys or install secrets.
 */
import {verify as ed25519Verify} from 'node:crypto';
import {gatePasses} from '../council-trusted-gate.mjs';

const SCHEMA='ultron.composio.council-attestation.v1';
const DOMAIN='ULTRON-COMPOSIO-COUNCIL-ATTESTATION-v1\n';
const SHA=/^[a-f0-9]{40}$/;
const KID=/^council-[a-z0-9-]{3,48}$/;
const NONCE=/^council-[a-z0-9_-]{16,96}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const TTL_MS=300_000;
const factoryVerifiers=new WeakSet();
const fail=reason=>{throw Error('Composio Council attestation denied: '+reason);};
const exact=(value,names)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===names.length&&Object.keys(value).every(k=>names.includes(k));

function canonical(value) {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort()
   .map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function normalize(attestation) {
 const envelope=['schema','keyId','sourceSha','prNumber','issuedAt','expiresAt','nonce','result','signature'];
 if(!exact(attestation,envelope)||attestation.schema!==SCHEMA||
    !KID.test(attestation.keyId||'')||!SHA.test(attestation.sourceSha||'')||
    !Number.isSafeInteger(attestation.prNumber)||attestation.prNumber<1||
    !Number.isSafeInteger(attestation.issuedAt)||!Number.isSafeInteger(attestation.expiresAt)||
    attestation.expiresAt<=attestation.issuedAt||
    attestation.expiresAt-attestation.issuedAt>TTL_MS||
    !NONCE.test(attestation.nonce||'')||
    typeof attestation.signature!=='string'||!SIGNATURE.test(attestation.signature))
  fail('invalid attestation envelope');
 const d=attestation.result;
 const required=['status','approvedCount','securitySensitive','sourceSha','prNumber'];
 if(!exact(d,required)||d.status!=='accepted'||d.approvedCount!==7||
    d.securitySensitive!==false||d.sourceSha!==attestation.sourceSha||
    d.prNumber!==attestation.prNumber)
  fail('decision is not the seven-role non-sensitive accepted gate');
 return {
  schema:SCHEMA,keyId:attestation.keyId,sourceSha:attestation.sourceSha,
  prNumber:attestation.prNumber,issuedAt:attestation.issuedAt,
  expiresAt:attestation.expiresAt,nonce:attestation.nonce,
  result:{status:'accepted',approvedCount:7,securitySensitive:false,
    sourceSha:attestation.sourceSha,prNumber:attestation.prNumber},
 };
}
/** Exact bytes the separate Council signer must sign; never sign from agents. */
export function councilAttestationSigningBytes(attestation) {
 return Buffer.from(DOMAIN+canonical(normalize(attestation)));
}
/** A branded verifier can only be constructed with an Ed25519 public key
 * and an atomic nonce consumer; the latter must persist through restarts. */
export function createTrustedComposioCouncilVerifier({
 keys,nonceStore,clock=()=>Date.now()
}={}){
 if(!keys||typeof keys!=='object'||Object.getPrototypeOf(keys)===null&&
    Object.keys(keys).length===0||
    typeof nonceStore?.consume!=='function'||typeof clock!=='function')
  fail('pinned keys, trusted clock and durable nonce store required');
 const usable=new Map();
 for(const [id,key] of Object.entries(keys)){
  if(!KID.test(id)||key?.asymmetricKeyType!=='ed25519'||key.type!=='public')
   fail('untrusted Council public key configuration');
  usable.set(id,key);
 }
 if(!usable.size)fail('no pinned Council signer');
 const verifier=async(attestation,{sourceSha,prNumber}={})=>{
  const message=normalize(attestation);
  if(!SHA.test(sourceSha||'')||!Number.isSafeInteger(prNumber)||
     message.sourceSha!==sourceSha||message.prNumber!==prNumber)
   fail('exact PR/source binding mismatch');
  const now=clock();
  if(!Number.isSafeInteger(now)||now<message.issuedAt-60_000||
     now>=message.expiresAt||now-message.issuedAt>TTL_MS)
   fail('Council attestation expired or future dated');
  const key=usable.get(message.keyId);
  if(!key)fail('Council signer not pinned');
  const sig=Buffer.from(attestation.signature,'base64url');
  if(sig.length!==64||sig.toString('base64url')!==attestation.signature||
     !ed25519Verify(null,councilAttestationSigningBytes(attestation),key,sig))
   fail('Council signature invalid');
  if(!gatePasses(message.result,sourceSha,prNumber))
   fail('verified Council decision is held');
  // This MUST be one atomic, durable consume-if-absent transaction. Network or
  // storage uncertainty fails closed, and the nonce is never retried silently.
  let consumed;
  try{
   consumed=await nonceStore.consume({
    keyId:message.keyId,nonce:message.nonce,sourceSha,prNumber,
    expiresAt:message.expiresAt,
   });
  }catch{
   fail('durable Council nonce consumption unavailable');
  }
  if(consumed!==true)fail('Council nonce already used or not durably reserved');
  return Object.freeze({...message.result});
 };
 factoryVerifiers.add(verifier);
 return verifier;
}
export function isTrustedComposioCouncilVerifier(fn){
 return typeof fn==='function'&&factoryVerifiers.has(fn);
}
