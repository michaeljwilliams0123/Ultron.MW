import { evaluateImprovementCandidate } from './learning.mjs';
import { cloudReceiptFingerprint } from './universal-cloud-executor.mjs';

const HASH=/^[a-f0-9]{64}$/;
const blocked=reason=>Object.freeze({
  schema:'ultron.cloud-learning-disposition.v1',
  disposition:'Blocked',reason,publication:'not-performed',
  releaseAuthority:'github-protected-pr',
});

/**
 * Evaluate a cloud skill candidate ONLY after an independent PostgreSQL
 * postcondition readback. readVerifiedReceipt must be bound by the trusted
 * server, not furnished by any model, agent, API caller or candidate skill.
 *
 * This is a selection gate. No evaluator result can grant a capability,
 * write a repository, deploy an artifact or promote model weights.
 */
export async function assessUniversalCloudSkill({
  trajectory,receiptKey,readVerifiedReceipt,candidate,cases,evaluator,groundTruth,
}={}){
  if(typeof receiptKey!=='string'||!receiptKey.length||
     typeof readVerifiedReceipt!=='function')
    return blocked('trusted-durable-receipt-reader-required');
  if(!trajectory||trajectory.schema!=='ultron.cloud-trajectory.v1'||
     trajectory.outcome!=='succeeded'||trajectory.independentlyObserved!==true||
     trajectory.costUsd!==0||!HASH.test(trajectory.fingerprint||'')||
     typeof trajectory.provider!=='string'||
     typeof trajectory.operation!=='string')
    return blocked('trajectory-unverified-or-nonzero-spend');
  let persisted;
  try{persisted=await readVerifiedReceipt(receiptKey);}
  catch{return blocked('independent-postgres-readback-unavailable');}
  const receipt=persisted?.receipt;
  if(persisted?.source!=='postgres-readback'||
     persisted?.verified!==true||persisted?.status!=='completed'||
     !receipt||typeof receipt!=='object'||Array.isArray(receipt)||
     receipt.idempotencyKey!==receiptKey||
     receipt.provider!==trajectory.provider||
     receipt.operation!==trajectory.operation||
     receipt.costCents!==0||
     !HASH.test(receipt.requestDigest||'')||
     !Number.isSafeInteger(receipt.fencingEpoch)||receipt.fencingEpoch<1||
     typeof receipt.externalId!=='string'||!receipt.externalId.length||
     !Number.isFinite(Date.parse(receipt.verifiedAt))||
     cloudReceiptFingerprint(receipt)!==trajectory.fingerprint)
    return blocked('unverified-terminal-postcondition-or-trajectory-mismatch');
  try{
    const report=evaluateImprovementCandidate({
      candidate,cases,evaluator,domain:'generated-capability-safety',
      groundTruth,
    });
    return Object.freeze({...report,
      sourceReceiptKey:receiptKey,sourceReceiptDigest:trajectory.fingerprint,
      publication:'not-performed',releaseAuthority:'github-protected-pr',
    });
  }catch{return blocked('reef-selection-evidence-invalid');}
}
