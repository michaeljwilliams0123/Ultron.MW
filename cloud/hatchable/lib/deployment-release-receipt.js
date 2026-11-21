import {verifyDelegatedGrant} from './security-adjudicator.js';
import {
 DEPLOYMENT_RECEIPT_POLICY_SHA,
 DEPLOYMENT_RECEIPT_ACTOR,
 DEPLOYMENT_RECEIPT_OPERATION,
 deploymentReceiptPublicResult,
 deploymentReceiptResource,
 normalizeDeploymentReceiptRequest,
 deploymentArtifactDigest,
 findDeploymentReleaseReceipt,
 prepareDeploymentReleaseReceipt,
 readDeploymentReleaseReceipt,
} from './deployment-release-receipt/read.js';

export {
 DEPLOYMENT_RECEIPT_POLICY_SHA,
 deploymentArtifactDigest,
 deploymentReceiptResource,
 findDeploymentReleaseReceipt,
 normalizeDeploymentReceiptRequest,
 prepareDeploymentReleaseReceipt,
 readDeploymentReleaseReceipt,
};

const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});

async function recordDeploymentReleaseReceipt({db,verifiedGrant,input}){
 if(!db?.query||!input||
   verifiedGrant.operation!==DEPLOYMENT_RECEIPT_OPERATION||
   verifiedGrant.administrativeChange!==false||
   verifiedGrant.policySha!==DEPLOYMENT_RECEIPT_POLICY_SHA||
   verifiedGrant.objectiveId!==input.key||
   verifiedGrant.resource!==deploymentReceiptResource(input))
  throw Error('invalid-deployment-release-receipt');
 if(!Number.isSafeInteger(verifiedGrant.profileVersion)||verifiedGrant.profileVersion<1||
   !Number.isSafeInteger(verifiedGrant.stopVersion)||verifiedGrant.stopVersion<1)
  return {ok:false,error:'grant-unbound'};
 const sql=`WITH authority AS MATERIALIZED (
  SELECT 1 FROM brain_owner_autonomy_profile a
  JOIN brain_runtime_control c ON c.id=1
  WHERE a.id=1 AND a.owner='michaeljwilliams0123'
   AND a.preset IN ('build','release') AND a.version=$12 AND c.version=$13
   AND NOT c.paused AND a.max_paid_cents=0
   AND jsonb_exists(a.allowed_operations,'cloud.deploy')
  FOR SHARE
 ), existing AS MATERIALIZED (
  SELECT id AS receipt_id,receipt_key,target,source_sha,artifact_digest,
   manifest_file_count,independent_readback,grant_id,policy_sha,
   profile_version,stop_version
  FROM brain_deployment_release_receipts
  WHERE receipt_key=$1 OR grant_id=$2 OR
   (target=$8 AND source_sha=$9 AND artifact_digest=$10)
 ), admitted AS (
  INSERT INTO brain_authority_grants(
   grant_id,objective_id,actor,operation,resource,policy_sha,expires_at)
  SELECT $2,$3,$4,'cloud.deploy',$5,$6,$7::timestamptz
  WHERE $7::timestamptz>clock_timestamp()
   AND EXISTS(SELECT 1 FROM (TABLE authority) AS authority)
   AND NOT EXISTS(SELECT 1 FROM (TABLE existing) AS existing)
  ON CONFLICT(grant_id) DO NOTHING RETURNING grant_id
 ), recorded AS (
  INSERT INTO brain_deployment_release_receipts(
   receipt_key,target,source_sha,artifact_digest,manifest_file_count,
   independent_readback,grant_id,policy_sha,profile_version,stop_version)
  SELECT $1,$8,$9,$10,$11,true,grant_id,$6,$12,$13
  FROM (TABLE admitted) AS admitted
  RETURNING id AS receipt_id,receipt_key,target,source_sha,artifact_digest,
   manifest_file_count,independent_readback,grant_id,policy_sha,
   profile_version,stop_version
 ), event AS (
  INSERT INTO brain_events(event_type,details)
  SELECT 'deployment-release-receipt-recorded',jsonb_build_object(
   'receiptId',receipt_id,'key',receipt_key,'target',target,
   'sourceSha',source_sha,'artifactDigest',artifact_digest,'grantId',grant_id)
  FROM (TABLE recorded) AS recorded RETURNING id
 )
 SELECT 'recorded' AS outcome,r.*,e.id AS event_id
 FROM (TABLE recorded) AS r JOIN (TABLE event) AS e ON true
 UNION ALL
 SELECT 'existing',x.*,NULL::bigint FROM (TABLE existing) AS x
 WHERE NOT EXISTS(SELECT 1 FROM (TABLE recorded) AS recorded)
 UNION ALL
 SELECT 'denied',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
 WHERE NOT EXISTS(SELECT 1 FROM (TABLE recorded) AS recorded)
  AND NOT EXISTS(SELECT 1 FROM (TABLE existing) AS existing)`;
 const result=await db.query(sql,[input.key,verifiedGrant.grantId,
  verifiedGrant.objectiveId,verifiedGrant.actor,verifiedGrant.resource,
  verifiedGrant.policySha,verifiedGrant.expiresAt,input.target,input.sourceSha,
  input.artifactDigest,input.manifestFileCount,verifiedGrant.profileVersion,
  verifiedGrant.stopVersion]);
 const rows=result?.rows||[],row=rows[0];
 if(rows.length!==1)return {ok:false,error:'receipt-conflict'};
 if(row.outcome==='denied')return {ok:false,error:
  Date.parse(verifiedGrant.expiresAt)<=Date.now()?'grant-expired':'authority-denied'};
 const same=row.receipt_key===input.key&&row.target===input.target&&
  row.source_sha===input.sourceSha&&row.artifact_digest===input.artifactDigest&&
  Number(row.manifest_file_count)===input.manifestFileCount&&
  row.independent_readback===true&&row.grant_id===verifiedGrant.grantId&&
  row.policy_sha===verifiedGrant.policySha&&
  Number(row.profile_version)===verifiedGrant.profileVersion&&
  Number(row.stop_version)===verifiedGrant.stopVersion;
 if(!same)return {ok:false,error:'receipt-conflict'};
 return {ok:true,status:'observed',receiptId:row.receipt_id,
  receiptKey:row.receipt_key,target:row.target,sourceSha:row.source_sha,
  artifactDigest:row.artifact_digest,manifestFileCount:Number(row.manifest_file_count),
  independentReadback:true,grantId:row.grant_id,
  profileVersion:Number(row.profile_version),stopVersion:Number(row.stop_version),
  reused:row.outcome==='existing'};
}

export async function submitDeploymentReleaseReceipt({db,config,request,envelope}={}){
 const input=normalizeDeploymentReceiptRequest(request);
 if(!input||typeof db?.query!=='function'||typeof config?.get!=='function')
  return held('request-invalid');
 let publicJwk;
 try{publicJwk=JSON.parse(await config.get('ULTRON_SECURITY_ADJUDICATOR_PUBLIC_JWK'));}
 catch{return held('adjudicator-unconfigured');}
 const grantRequest={actor:DEPLOYMENT_RECEIPT_ACTOR,objectiveId:input.key,
  operation:DEPLOYMENT_RECEIPT_OPERATION,
  resource:deploymentReceiptResource(input),administrativeChange:false};
 let verified;
 try{verified=await verifyDelegatedGrant({envelope,publicJwk,request:grantRequest});}
 catch{return held('owner-grant-invalid');}
 if(verified.policySha!==DEPLOYMENT_RECEIPT_POLICY_SHA)
  return held('owner-grant-policy-invalid');
 let result;
 try{result=await recordDeploymentReleaseReceipt({db,verifiedGrant:verified,input});}
 catch{return uncertain('receipt-ledger-unavailable');}
 if(!result.ok)return result.status==='observed'?result:
  held(result.error||'receipt-record-denied');
 return deploymentReceiptPublicResult(result);
}
