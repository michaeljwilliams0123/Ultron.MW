/**
 * C03 source-only durable completion storage for the separately signed
 * read-only Destiny Codex Cloud canary. No executor dispatch or account
 * authentication is implemented here.
 *
 * Admission requires:
 *  - independently read C01 intent; exact immutable delivery and objective
 *  - independently registered C03 route for destiny-codex-cloud
 *  - pinned Ed25519 signer + GitHub-authoritative actor observation
 *  - single immutable receipt per delivery and independent SQL readback
 *
 * An uncertain write is never retried by this function.
 */
import {assessDestinyCanary,canonicalDestinyReceipt}
  from './destiny-executor-attestation.mjs';
const INTENT=['repository','taskId','deliveryId','requestSha','sourceSha',
  'routeSha','effect','maxPaidCents'];

function snapshotOwn(record,fields){
  if(!record||typeof record!=='object'||Array.isArray(record))
    throw Error('destiny-completion-blocked-input');
  let descriptors;
  try {descriptors=Object.getOwnPropertyDescriptors(record);}
  catch {throw Error('destiny-completion-blocked-input');}
  const names=fields??Object.keys(descriptors);
  if(names.length<1||names.length>30)
    throw Error('destiny-completion-blocked-input');
  const result=Object.create(null);
  for(const key of names){
    const field=descriptors[key];
    if(!field?.enumerable||!Object.prototype.hasOwnProperty.call(field,'value'))
      throw Error('destiny-completion-blocked-input');
    result[key]=field.value;
  }
  return Object.freeze(result);
}

function matches(row,params){
  if(!row||typeof row!=='object'||Array.isArray(row))return false;
  const keys=['deliveryId','taskId','sourceSha','requestSha','routeSha',
    'receiptSha','canonical','signature','actor','environment','keyId','resultSha'];
  return keys.every((key,i)=>row[key]===params[i]);
}

function result({created,receiptSha,reconciled=false}){
  return Object.freeze({
    recorded:true,created,reconciled,receiptSha,
    verification:'signed-executor-key-only',
    workAccountAuthenticated:false,
    productionAccepted:false,
  });
}

/**
 * A caller MUST source intent from authoritative C01 database readback and
 * observedGitHubActor from authenticated GitHub API readback. The trust key is
 * independently provisioned; never accept it from a PR or candidate result.
 *
 * The C01 objective_id for this route MUST equal the independently admitted
 * Codex taskId. Missing registration intentionally fails closed.
 */
export async function recordDestinyCompletion({
  db,intent,receipt,signature,trust,observedGitHubActor,now=Date.now()
}={}){
  if(typeof db?.query!=='function')throw Error('destiny-completion-db-required');
  const canonicalIntent=snapshotOwn(intent,INTENT);
  const canonicalReceipt=snapshotOwn(receipt);
  const observed=assessDestinyCanary({
    intent:canonicalIntent,receipt:canonicalReceipt,signature,trust,
    observedGitHubActor,now
  });
  if(!observed.verifiedReceipt)
    throw Error('destiny-completion-'+observed.status);

  const params=[
    canonicalIntent.deliveryId,canonicalIntent.taskId,
    canonicalIntent.sourceSha,canonicalIntent.requestSha,
    canonicalIntent.routeSha,observed.receiptSha,
    canonicalDestinyReceipt(canonicalReceipt),signature,
    canonicalReceipt.githubActor,canonicalReceipt.environmentFingerprint,
    canonicalReceipt.keyId,canonicalReceipt.resultSha,
  ];

  const readback=async()=>{
    const rows=await db.query(`SELECT delivery_id AS "deliveryId",
      task_id AS "taskId",source_sha AS "sourceSha",
      request_sha AS "requestSha",route_sha AS "routeSha",
      receipt_sha AS "receiptSha",canonical_receipt AS "canonical",
      signature_base64 AS "signature",github_actor AS "actor",
      environment_fingerprint AS "environment",key_id AS "keyId",
      result_sha AS "resultSha"
      FROM brain_destiny_completions WHERE delivery_id=$1`,
      [canonicalIntent.deliveryId]);
    if(!rows||!Array.isArray(rows.rows)||rows.rows.length>1)
      throw Error('destiny-completion-write-uncertain');
    return rows.rows[0]??null;
  };

  let response,queryFailed=false;
  try{
    response=await db.query(`INSERT INTO brain_destiny_completions
      (delivery_id,task_id,source_sha,request_sha,route_sha,receipt_sha,
       canonical_receipt,signature_base64,github_actor,environment_fingerprint,
       key_id,result_sha)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      FROM brain_continuum_outbox o
      JOIN brain_continuum_routes r ON r.delivery_id=o.delivery_id
      WHERE o.delivery_id=$1 AND o.objective_id=$2
        AND o.repository='michaeljwilliams0123/Ultron.MW'
        AND o.source_sha=$3 AND o.request_sha=$4
        AND r.route_sha=$5 AND r.source='destiny-codex-cloud'
        AND o.effect='read' AND o.max_paid_cents=0
        AND o.state IN ('pending','reconcile-required')
      ON CONFLICT DO NOTHING
      RETURNING delivery_id AS "deliveryId",receipt_sha AS "receiptSha"`,
      params);
  }catch{queryFailed=true;}

  let stored;
  try{stored=await readback();}
  catch{throw Error('destiny-completion-write-uncertain');}
  if(queryFailed){
    if(!matches(stored,params))
      throw Error('destiny-completion-write-uncertain');
    // INSERT may have committed despite transport loss. Never repeat it.
    return result({created:false,receiptSha:observed.receiptSha,reconciled:true});
  }
  if(!response||!Array.isArray(response.rows)||response.rows.length>1)
    throw Error('destiny-completion-write-uncertain');
  if(response.rows.length===1){
    if(response.rows[0]?.deliveryId!==canonicalIntent.deliveryId||
      response.rows[0]?.receiptSha!==observed.receiptSha)
      throw Error('destiny-completion-write-uncertain');
    if(!matches(stored,params))
      throw Error('destiny-completion-write-uncertain');
    return result({created:true,receiptSha:observed.receiptSha});
  }
  if(stored===null)throw Error('destiny-completion-route-unadmitted');
  if(!matches(stored,params))throw Error('destiny-completion-conflict');
  return result({created:false,receiptSha:observed.receiptSha});
}
