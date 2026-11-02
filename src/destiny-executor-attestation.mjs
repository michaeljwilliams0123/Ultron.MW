/**
 * C03 cloud Codex handoff. Verify a bounded, separately signed completion
 * receipt against authoritative C01 intent, pinned cloud environment metadata,
 * and actual GitHub write actor read back from GitHub, never a payload claim.
 *
 * GitHub account connection != Codex Cloud account. A signature attests control
 * of an executor key, not a human/ChatGPT identity. No dispatch, credential
 * creation, merge, deployment, paid calls, or production acceptance is here.
 */
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';

export const DESTINY_RECEIPT_SCHEMA='ultron.destiny.execution-receipt.v2';
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9_.:-]{11,127}$/i;
const ACTOR=/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const FIELDS=[
  'authorId','deliveryId','effect','environmentFingerprint','executionLane',
  'expiresAt','githubActor','issuedAt','keyId','maxPaidCents','repository',
  'requestSha','resultSha','routeSha','schema','sourceSha','status','taskId'
].sort();
const MAX_LIFETIME=300000,MAX_FUTURE_SKEW=30000,MAX_ISSUED_AGE=600000;
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validTime=x=>typeof x==='string'&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&
  Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const deny=status=>Object.freeze({status,verifiedReceipt:false,receiptSha:null,
  workAccountAuthenticated:false,productionAccepted:false});

export function canonicalDestinyReceipt(receipt){
  if(!isRecord(receipt))throw Error('destiny-receipt-invalid');
  return JSON.stringify(Object.fromEntries(Object.keys(receipt).sort()
    .map(key=>[key,receipt[key]])));
}
function validIntent(i){
  return isRecord(i)&&i.repository===REPO&&
    typeof i.taskId==='string'&&ID.test(i.taskId)&&
    typeof i.deliveryId==='string'&&ID.test(i.deliveryId)&&
    typeof i.requestSha==='string'&&DIGEST.test(i.requestSha)&&
    typeof i.sourceSha==='string'&&SHA.test(i.sourceSha)&&
    typeof i.routeSha==='string'&&DIGEST.test(i.routeSha)&&
    i.effect==='read'&&i.maxPaidCents===0;
}
function verifiedTrust(t){
  if(!isRecord(t)||t.state!=='configured'||
     t.executionLane!=='codex-cloud'||typeof t.githubActor!=='string'||
     !ACTOR.test(t.githubActor)||typeof t.environmentFingerprint!=='string'||
     !DIGEST.test(t.environmentFingerprint)||
     typeof t.keyId!=='string'||!/^[-a-z0-9]{4,64}$/.test(t.keyId)||
     typeof t.publicKeyPem!=='string')return null;
  try{
    const key=createPublicKey(t.publicKeyPem);
    return key.asymmetricKeyType==='ed25519'?key:null;
  }catch{return null;}
}
// Capture one immutable set of own data properties before validating or
// verifying a signature. Accessor-backed fields must not be able to change
// between signature verification and the persisted receipt digest.
function snapshotReceipt(receipt){
  if(!isRecord(receipt))return null;
  const descriptors=Object.getOwnPropertyDescriptors(receipt);
  const keys=Object.keys(descriptors);
  if(keys.length!==FIELDS.length||keys.sort().join(',')!==FIELDS.join(','))
    return null;
  const captured=Object.create(null);
  for(const key of FIELDS){
    const descriptor=descriptors[key];
    if(!descriptor?.enumerable||
       !Object.prototype.hasOwnProperty.call(descriptor,'value'))return null;
    captured[key]=descriptor.value;
  }
  return Object.freeze(captured);
}
function validReceipt(r){
  return isRecord(r)&&Object.keys(r).sort().join(',')===FIELDS.join(',')&&
    r.schema===DESTINY_RECEIPT_SCHEMA&&r.repository===REPO&&
    typeof r.taskId==='string'&&ID.test(r.taskId)&&
    typeof r.deliveryId==='string'&&ID.test(r.deliveryId)&&
    typeof r.requestSha==='string'&&DIGEST.test(r.requestSha)&&
    typeof r.sourceSha==='string'&&SHA.test(r.sourceSha)&&
    typeof r.routeSha==='string'&&DIGEST.test(r.routeSha)&&
    r.authorId==='destiny-codex'&&r.executionLane==='codex-cloud'&&
    typeof r.githubActor==='string'&&ACTOR.test(r.githubActor)&&
    typeof r.environmentFingerprint==='string'&&DIGEST.test(r.environmentFingerprint)&&
    typeof r.keyId==='string'&&/^[-a-z0-9]{4,64}$/.test(r.keyId)&&
    r.effect==='read'&&r.maxPaidCents===0&&r.status==='completed'&&
    typeof r.resultSha==='string'&&DIGEST.test(r.resultSha)&&
    validTime(r.issuedAt)&&validTime(r.expiresAt);
}
function signatureBytes(s){
  if(typeof s!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(s))return null;
  const bytes=Buffer.from(s,'base64');
  return bytes.length===64&&bytes.toString('base64')===s?bytes:null;
}
/**
 * The caller must obtain intent from authoritative database readback and the
 * observedGitHubActor from GitHub's authenticated commit/event API. Neither
 * may be taken from the PR/receipt being assessed.
 *
 * A Codex Cloud environment ID fingerprint is correlation data, not an
 * independent Work account attestation. Trust must be provisioned separately.
 * Unknown writes require readback reconciliation before any retry.
 */
export function assessDestinyCanary({intent,receipt,signature,trust,
  observedGitHubActor,now=Date.now(),priorReceiptSha}={}){
  try{
    if(!validIntent(intent))return deny('blocked-intent');
    const key=verifiedTrust(trust);
    if(!key)return deny('blocked-unconfigured');
    if(typeof observedGitHubActor!=='string'||
       observedGitHubActor!==trust.githubActor)return deny('blocked-actor');
    const capturedReceipt=snapshotReceipt(receipt);
    if(!capturedReceipt||!validReceipt(capturedReceipt))return deny('blocked-receipt');
    if(capturedReceipt.keyId!==trust.keyId||
       capturedReceipt.githubActor!==observedGitHubActor||
       capturedReceipt.environmentFingerprint!==trust.environmentFingerprint||
       capturedReceipt.executionLane!==trust.executionLane||
       ['repository','taskId','deliveryId','requestSha','sourceSha','routeSha',
         'effect','maxPaidCents'].some(k=>capturedReceipt[k]!==intent[k]))
      return deny('blocked-correlation');
    const issued=Date.parse(capturedReceipt.issuedAt),expiry=Date.parse(capturedReceipt.expiresAt);
    if(!Number.isFinite(now)||expiry<=issued||expiry-issued>MAX_LIFETIME||
       issued>now+MAX_FUTURE_SKEW||now>expiry||issued<now-MAX_ISSUED_AGE)
      return deny('blocked-expired');
    const bytes=signatureBytes(signature);
    if(!bytes||!verifySignature(null,
       Buffer.from(canonicalDestinyReceipt(capturedReceipt),'utf8'),key,bytes))
      return deny('blocked-signature');
    const receiptSha=createHash('sha256')
      .update(canonicalDestinyReceipt(capturedReceipt)).digest('hex');
    if(priorReceiptSha!==undefined&&priorReceiptSha!==null){
      if(typeof priorReceiptSha!=='string'||!DIGEST.test(priorReceiptSha)||
         priorReceiptSha!==receiptSha)return deny('reconcile-required');
      return Object.freeze({status:'already-recorded',verifiedReceipt:true,
        receiptSha,workAccountAuthenticated:false,productionAccepted:false});
    }
    return Object.freeze({status:'verified-executor-receipt',verifiedReceipt:true,
      receiptSha,workAccountAuthenticated:false,productionAccepted:false});
  }catch{return deny('blocked-receipt');}
}
