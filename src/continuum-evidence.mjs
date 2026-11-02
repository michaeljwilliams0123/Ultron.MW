/** Continuum #204: source-only, fail-closed receipt assessment.
 * This pure function cannot authenticate a provider, verify a GitHub review,
 * or establish production acceptance. Those require independent live readback.
 */
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{3,127}$/;
const VERSION=/^v[1-9][0-9]*$/;
const TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SCHEMA='ultron.continuum-evidence.v1';
const RESULT_SCHEMA='ultron.continuum-assessment.v1';
const safeInt=value=>Number.isSafeInteger(value)&&value>=0;
const validTime=value=>typeof value==='string'&&TIMESTAMP.test(value)&&
  Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const validUrl=value=>typeof value==='string'&&
  /^https:\/\/[A-Za-z0-9.-]+(?::443)?\/[A-Za-z0-9_./#?=&%-]*$/.test(value);
const result=(disposition,reason)=>Object.freeze({
  schema:RESULT_SCHEMA,disposition,reason,productionAccepted:false
});
const held=reason=>result('held',reason);

// Capture all caller-controlled properties once. Getters/proxies may throw;
// neither a second read nor JS coercion can be an authorization primitive.
function snapshot(record){
  const a=record.authorization,i=record.intent,b=record.readback,v=record.review;
  return {
    schema:record.schema,objectiveId:record.objectiveId,taskId:record.taskId,
    deliveryId:record.deliveryId,actorId:record.actorId,runtimeId:record.runtimeId,
    baseSha:record.baseSha,headSha:record.headSha,deployedSha:record.deployedSha,
    capability:record.capability,policyVersion:record.policyVersion,
    authorization:a&&{grantId:a.grantId,expiresAt:a.expiresAt,resource:a.resource,fence:a.fence},
    idempotencyKey:record.idempotencyKey,attempt:record.attempt,
    intent:i&&{effect:i.effect,preconditionSha:i.preconditionSha,estimatedPaidCents:i.estimatedPaidCents},
    outcome:record.outcome,
    readback:b&&{observerId:b.observerId,deliveryId:b.deliveryId,headSha:b.headSha,
      fence:b.fence,observedEffect:b.observedEffect,evidenceUrl:b.evidenceUrl},
    review:v&&{reviewerId:v.reviewerId,headSha:v.headSha,
      decision:v.decision,evidenceUrl:v.evidenceUrl},
    elapsedMs:record.elapsedMs,observedPaidCents:record.observedPaidCents,
    artifacts:Array.isArray(record.artifacts)?[...record.artifacts]:record.artifacts
  };
}
function validCore(c,expectedHeadSha,now){
  if(c.schema!==SCHEMA||typeof expectedHeadSha!=='string'||!SHA.test(expectedHeadSha)||!validTime(now))return false;
  for(const key of ['objectiveId','taskId','deliveryId','actorId','runtimeId','capability','idempotencyKey'])
    if(typeof c[key]!=='string'||!ID.test(c[key]))return false;
  if(typeof c.baseSha!=='string'||!SHA.test(c.baseSha)||
    typeof c.headSha!=='string'||!SHA.test(c.headSha)||c.headSha!==expectedHeadSha||
    (c.deployedSha!==null&&c.deployedSha!==undefined&&
      (typeof c.deployedSha!=='string'||!SHA.test(c.deployedSha)))||
    typeof c.policyVersion!=='string'||!VERSION.test(c.policyVersion))return false;
  const a=c.authorization,i=c.intent;
  if(!a||typeof a.grantId!=='string'||!ID.test(a.grantId)||
    typeof a.resource!=='string'||!ID.test(a.resource)||
    !validTime(a.expiresAt)||Date.parse(a.expiresAt)<=Date.parse(now)||
    !Number.isSafeInteger(a.fence)||a.fence<1||
    !Number.isSafeInteger(c.attempt)||c.attempt<1)return false;
  if(!i||!['read','write'].includes(i.effect)||
    typeof i.preconditionSha!=='string'||!DIGEST.test(i.preconditionSha)||
    i.estimatedPaidCents!==0||c.observedPaidCents!==0||
    !safeInt(c.elapsedMs)||!['unknown','failed','acknowledged'].includes(c.outcome))return false;
  return Array.isArray(c.artifacts)&&c.artifacts.length<=100&&
    c.artifacts.every(validUrl);
}
export function assessContinuumEvidence(record,{expectedHeadSha,now}={}){
  if(!record||typeof record!=='object'||Array.isArray(record))
    return held('invalid-envelope');
  let c;
  try {c=snapshot(record);}catch{return held('invalid-envelope');}
  if(!validCore(c,expectedHeadSha,now))return held('invalid-contract-or-authority');
  const b=c.readback,v=c.review;
  if(b!==null&&b!==undefined){
    if(typeof b.observerId!=='string'||!ID.test(b.observerId)||
      b.observerId===c.actorId||b.observerId===c.runtimeId||
      b.deliveryId!==c.deliveryId||b.headSha!==c.headSha||
      b.fence!==c.authorization.fence||
      !['present','absent','unknown'].includes(b.observedEffect)||
      !validUrl(b.evidenceUrl))return held('invalid-or-self-readback');
  }
  if(v!==null&&v!==undefined){
    if(typeof v.reviewerId!=='string'||!ID.test(v.reviewerId)||
      v.reviewerId===c.actorId||v.reviewerId===c.runtimeId||
      v.headSha!==c.headSha||v.decision!=='approved'||
      !validUrl(v.evidenceUrl))return held('invalid-or-self-review');
  }
  if(c.intent.effect==='read')return result('source-only','no-live-effect-certification');
  if(!b||b.observedEffect!=='present')
    return result('reconcile-required','external-write-unproved');
  if(!v)return held('independent-review-unproved');
  // Structurally consistent evidence is still an UNVERIFIED claim. This
  // function never queries GitHub, Hatchable, or the independent provider.
  return result('observed-not-accepted','external-attestation-required');
}
export function assessContinuumEvidenceBatch(records,options={}){
  if(!Array.isArray(records)||records.length===0||records.length>100)
    return held('invalid-batch');
  const seen=new Map();
  for(const record of records){
    let c;
    try {c=snapshot(record);}catch{return held('invalid-envelope');}
    if(typeof c.deliveryId!=='string')return held('invalid-delivery');
    // Validate the one captured snapshot before comparing identities. This
    // avoids coercing untrusted objects or reading caller getters twice.
    const assessed=assessContinuumEvidence(c,options);
    if(assessed.disposition==='held')return assessed;
    // A delivery ID binds the complete validated immutable envelope, not
    // just the execution precondition. Conflicting outcomes, actors, attempts
    // or purported independent receipts must never be silently deduplicated.
    // Validation above guarantees these snapshot fields are plain primitives.
    const identity=JSON.stringify(c);
    if(seen.has(c.deliveryId)&&seen.get(c.deliveryId)!==identity)
      return held('conflicting-delivery');
    seen.set(c.deliveryId,identity);
  }
  return result('batch-unverified','per-record-independent-readback-required');
}
