/**
 * UUAM Council attestation validator.
 *
 * Seven independent Ed25519 signatures, not MPC/TSS or a ZK proof.
 * This is an evidence validator, NEVER a standalone authorization grant.
 * Callers must separately verify owner authorization, consume nonces in
 * PostgreSQL, and respect the existing 7/7 release gate.
 */
import {createPublicKey,verify} from 'node:crypto';

const REPO='michaeljwilliams0123/Ultron.MW';
const DIGEST=/^[a-f0-9]{64}$/;
const NONCE=/^[a-f0-9]{32,64}$/;
const ID=/^[a-zA-Z0-9._:-]{1,80}$/;
const FIELDS=['repo','operation','planDigest','ownerGrantHash',
  'nonce','expiresAt','policyVersion'];
function exact(value,fields){
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.getPrototypeOf(value)===Object.prototype&&
    Object.keys(value).length===fields.length&&
    fields.every(key=>Object.hasOwn(value,key)&&
      Object.getOwnPropertyDescriptor(value,key)?.get===undefined);
}

export class CouncilAttestationVerifier {
  #members;
  #policyVersion;
  #allowedOperations;
  constructor({members,threshold=7,policyVersion,allowedOperations}={}){
    if(!Array.isArray(members)||members.length!==7||threshold!==7||
       !ID.test(policyVersion||'')||!Array.isArray(allowedOperations)||
       allowedOperations.length<1||allowedOperations.some(x=>!ID.test(x))||
       new Set(allowedOperations).size!==allowedOperations.length)
      throw Error('Invalid seven-member Council threshold policy');
    this.#policyVersion=policyVersion;
    this.#allowedOperations=new Set(allowedOperations);
    this.#members=new Map();
    const fingerprints=new Set();
    for(const member of members){
      if(!member||!ID.test(member.id||'')||this.#members.has(member.id))
        throw Error('Duplicate or invalid Council signer identity');
      const key=createPublicKey(member.publicKeyPem);
      if(key.asymmetricKeyType!=='ed25519')
        throw Error('Expected Ed25519 Council public key');
      const fingerprint=key.export({format:'der',type:'spki'}).toString('hex');
      if(fingerprints.has(fingerprint))
        throw Error('Duplicate Council signing key');
      fingerprints.add(fingerprint);
      this.#members.set(member.id,Object.freeze({
        key,enabled:member.enabled!==false
      }));
    }
  }
  verifyConsensus(intent,signatures,now=Date.now()){
    if(!exact(intent,FIELDS)||!Number.isSafeInteger(now)||
       !Array.isArray(signatures)||signatures.length<7||
       signatures.length>32)return false;
    const {repo,operation,planDigest,ownerGrantHash,nonce,
      expiresAt,policyVersion}=intent;
    if(repo!==REPO||!this.#allowedOperations.has(operation)||
       !DIGEST.test(planDigest)||!DIGEST.test(ownerGrantHash)||
       !NONCE.test(nonce)||policyVersion!==this.#policyVersion||
       !Number.isSafeInteger(expiresAt)||expiresAt<=now||
       expiresAt>now+300000)return false;
    const bytes=Buffer.from(JSON.stringify([
      'UUAM-COUNCIL-V1',repo,operation,planDigest,ownerGrantHash,
      nonce,expiresAt,policyVersion
    ]));
    const accepted=new Set();
    for(const entry of signatures){
      const member=this.#members.get(entry?.signerId);
      if(!member?.enabled||accepted.has(entry.signerId)||
         typeof entry.signature!=='string')continue;
      try{
        const sig=Buffer.from(entry.signature,'base64url');
        if(sig.length!==64||sig.toString('base64url')!==entry.signature)continue;
        if(verify(null,bytes,member.key,sig))accepted.add(entry.signerId);
      }catch{/* Fail closed on malformed signatures. */}
    }
    return accepted.size===7;
  }
}
