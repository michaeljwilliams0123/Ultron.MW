/**
 * C03 Destiny handoff: verification-only, separately signed completion canary.
 *
 * Existing continuum-ack verifies DELIVERY/ACK (never execution). This module
 * verifies a bounded execution RECEIPT against the trusted C01 outbox intent,
 * independently pinned receiver key and a GitHub App actor observed through
 * authenticated GitHub readback. It NEVER performs dispatch, writes to a DB,
 * authorizes paid calls, installs an App or attests a ChatGPT Work account.
 */
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';

export const DESTINY_RECEIPT_SCHEMA='ultron.destiny.execution-receipt.v1';
const APP='ultron-destiny-executor[bot]';
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9_.:-]{11,127}$/i;
const FIELD_NAMES=[
  'appLogin','authorId','deliveryId','effect','expiresAt','issuedAt',
  'keyId','maxPaidCents','repository','requestSha','resultSha','routeSha',
  'schema','sourceSha','status','taskId'
].sort();
const MAX_AGE=300000;
const maxSource=600000;
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validTime=x=>typeof x==='string'&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&
  Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const deny=status=>Object.freeze({status,verifiedReceipt:false,receiptSha:null,
  workAccountAuthenticated:false,productionAccepted:false});

/**
 * Stable UTF-8 bytes; does not grant authority. A signature over data is
 * meaningful only after the independent trust/config/correlation checks below.
 */
export function canonicalDestinyReceipt(receipt){
  if(!isRecord(receipt))throw Error('destiny-receipt-invalid');
  return JSON.stringify(Object.fromEntries(Object.keys(receipt).sort()
    .map(key=>[key,receipt[key]])));
}
function validIntent(intent){
  return isRecord(intent)&&intent.repository===REPO&&
    typeof intent.taskId==='string'&&ID.test(intent.taskId)&&
    typeof intent.deliveryId==='string'&&ID.test(intent.deliveryId)&&
    typeof intent.requestSha==='string'&&DIGEST.test(intent.requestSha)&&
    typeof intent.sourceSha==='string'&&SHA.test(intent.sourceSha)&&
    typeof intent.routeSha==='string'&&DIGEST.test(intent.routeSha)&&
    intent.effect==='read'&&intent.maxPaidCents===0;
}
function keyFromTrust(trust){
  if(!isRecord(trust)||trust.state!=='configured'||trust.appLogin!==APP||
    typeof trust.keyId!=='string'||!/^[-a-z0-9]{4,64}$/.test(trust.keyId)||
    typeof trust.publicKeyPem!=='string')return null;
  try{
    const key=createPublicKey(trust.publicKeyPem);
    return key.asymmetricKeyType==='ed25519'?key:null;
  }catch{return null;}
}
function validReceipt(receipt){
  return isRecord(receipt)&&Object.keys(receipt).sort().join(',')===FIELD_NAMES.join(',')&&
    receipt.schema===DESTINY_RECEIPT_SCHEMA&&
    receipt.repository===REPO&&
    typeof receipt.taskId==='string'&&ID.test(receipt.taskId)&&
    typeof receipt.deliveryId==='string'&&ID.test(receipt.deliveryId)&&
    typeof receipt.requestSha==='string'&&DIGEST.test(receipt.requestSha)&&
    typeof receipt.sourceSha==='string'&&SHA.test(receipt.sourceSha)&&
    typeof receipt.routeSha==='string'&&DIGEST.test(receipt.routeSha)&&
    receipt.authorId==='destiny-codex'&&receipt.appLogin===APP&&
    typeof receipt.keyId==='string'&&/^[-a-z0-9]{4,64}$/.test(receipt.keyId)&&
    receipt.effect==='read'&&receipt.maxPaidCents===0&&
    receipt.status==='completed'&&
    typeof receipt.resultSha==='string'&&DIGEST.test(receipt.resultSha)&&
    validTime(receipt.issuedAt)&&validTime(receipt.expiresAt);
}
function validSignatureText(signature){
  if(typeof signature!=='string'||!/[A-Za-z0-9+/]{86}==/.test(signature)||
     signature.length!==88)return null;
  const bytes=Buffer.from(signature,'base64');
  return bytes.length===64&&bytes.toString('base64')===signature?bytes:null;
}

/**
 * A caller MUST obtain `intent` from authoritative PostgreSQL readback, not
 * the PR being evaluated. `observedGitHubActor` must come from GitHub API
 * readback of the actual immutable receipt-creating commit or event, NOT
 * from the receipt itself. An App actor alone is NOT a Work identity.
 *
 * `priorReceiptSha` is the durable earlier receipt digest, if a delivery
 * already exists. This function does not decide whether an unknown write
 * occurred; the caller must independently reconcile it before any retry.
 */
export function assessDestinyCanary({intent,receipt,signature,trust,
  observedGitHubActor,now=Date.now(),priorReceiptSha}={}){
  try{
    if(!validIntent(intent))return deny('blocked-intent');
    const key=keyFromTrust(trust);
    if(!key)return deny('blocked-unconfigured');
    if(observedGitHubActor!==trust.appLogin||observedGitHubActor==='michaeljwilliams0123')
      return deny('blocked-actor');
    if(!validReceipt(receipt))return deny('blocked-receipt');
    if(receipt.keyId!==trust.keyId||
      ['repository','taskId','deliveryId','requestSha','sourceSha','routeSha',
        'effect','maxPaidCents'].some(k=>receipt[k]!==intent[k]))
      return deny('blocked-correlation');
    const issued=Date.parse(receipt.issuedAt);
    const expiry=Date.parse(receipt.expiresAt);
    if(!Number.isFinite(now)||expiry<=issued||expiry-issued>MAX_AGE||
      issued>now+MAX_AGE||now>expiry||issued<now-maxSource)
      return deny('blocked-expired');
    const bytes=validSignatureText(signature);
    if(!bytes)return deny('blocked-signature');
    const canonical=canonicalDestinyReceipt(receipt);
    if(!verifySignature(null,Buffer.from(canonical,'utf8'),key,bytes))
      return deny('blocked-signature');
    const receiptSha=createHash('sha256').update(canonical).digest('hex');
    if(priorReceiptSha!==undefined&&priorReceiptSha!==null){
      if(typeof priorReceiptSha!=='string'||!DIGEST.test(priorReceiptSha)||
        priorReceiptSha!==receiptSha)return deny('reconcile-required');
      return Object.freeze({status:'already-recorded',verifiedReceipt:true,
        receiptSha,workAccountAuthenticated:false,productionAccepted:false});
    }
    // Work account binding requires a separate independently authenticated
    // session/installation observation; a shared GitHub actor or pinned key
    // does not prove which ChatGPT account ran.
    return Object.freeze({status:'verified-executor-receipt',verifiedReceipt:true,
      receiptSha,workAccountAuthenticated:false,productionAccepted:false});
  }catch{return deny('blocked-receipt');}
}
