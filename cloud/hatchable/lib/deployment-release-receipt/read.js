import {createHash} from 'node:crypto';

const OWNER='michaeljwilliams0123';
export const DEPLOYMENT_RECEIPT_ACTOR='mcp:ultron';
export const DEPLOYMENT_RECEIPT_OPERATION='cloud.deploy';
export const DEPLOYMENT_RECEIPT_POLICY_SHA=createHash('sha256')
 .update('ultron.owner-signed-deployment-release-receipt.v1').digest('hex');
const KEY=/^[a-z0-9][a-z0-9-]{7,47}$/;
const TARGET=/^hatchable-v[1-9][0-9]{0,8}$/;
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const GRANT=/^[A-Za-z0-9_.:-]{8,128}$/;
const exact=(value,fields)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)return false;
 try{
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  return keys.length===fields.length&&keys.every(key=>typeof key==='string'&&
   fields.includes(key)&&descriptors[key].enumerable&&
   Object.hasOwn(descriptors[key],'value'));
 }catch{return false;}
};
const held=reason=>({ok:false,status:'held',reason});
const uncertain=reason=>({ok:false,status:'reconcile-required',reason});

export function normalizeDeploymentReceiptRequest(value){
 const fields=['key','target','sourceSha','artifactDigest','manifestFileCount',
  'independentReadback'];
 if(!exact(value,fields)||!KEY.test(value.key||'')||
   !TARGET.test(value.target||'')||!SHA.test(value.sourceSha||'')||
   !DIGEST.test(value.artifactDigest||'')||
   !Number.isSafeInteger(value.manifestFileCount)||
   value.manifestFileCount<1||value.manifestFileCount>5000||
   value.independentReadback!==true)return null;
 return Object.freeze({...value});
}

export function deploymentReceiptResource(request){
 const r=normalizeDeploymentReceiptRequest(request);
 if(!r)throw Error('deployment-receipt-request-invalid');
 return `hatchable:deployment:proj_A6GCXRSKizko:${r.target}:`+
  `${r.artifactDigest}:source:${r.sourceSha}`;
}

export async function prepareDeploymentReleaseReceipt({db,request}={}){
 const input=normalizeDeploymentReceiptRequest(request);
 if(!input||typeof db?.query!=='function')return held('request-invalid');
 const result=await db.query(`SELECT a.owner,a.preset,a.version AS profile_version,
  a.max_paid_cents,a.allowed_operations,c.paused,c.version AS stop_version
  FROM brain_owner_autonomy_profile a JOIN brain_runtime_control c ON c.id=1
  WHERE a.id=1`);
 const row=result?.rows?.[0];
 if(!row||row.owner!==OWNER||!['build','release'].includes(row.preset)||
   row.paused===true||Number(row.max_paid_cents)!==0||
   !Array.isArray(row.allowed_operations)||
   !row.allowed_operations.includes(DEPLOYMENT_RECEIPT_OPERATION)||
   !Number.isSafeInteger(Number(row.profile_version))||
   !Number.isSafeInteger(Number(row.stop_version)))return held('authority-denied');
 return {ok:true,status:'prepared',operation:DEPLOYMENT_RECEIPT_OPERATION,
  grantRequest:{actor:DEPLOYMENT_RECEIPT_ACTOR,objectiveId:input.key,
   operation:DEPLOYMENT_RECEIPT_OPERATION,
   resource:deploymentReceiptResource(input),administrativeChange:false,
   profileVersion:Number(row.profile_version),stopVersion:Number(row.stop_version),
   policySha:DEPLOYMENT_RECEIPT_POLICY_SHA}};
}

export function deploymentReceiptPublicResult(row){
 if(!row)return uncertain('receipt-not-observed');
 return {ok:true,status:'observed',operation:DEPLOYMENT_RECEIPT_OPERATION,
  key:row.receiptKey,
  target:row.target,sourceSha:row.sourceSha,artifactDigest:row.artifactDigest,
  manifestFileCount:Number(row.manifestFileCount),
  independentReadback:row.independentReadback===true,
  grantId:row.grantId,receiptId:String(row.receiptId),
  profileVersion:Number(row.profileVersion),stopVersion:Number(row.stopVersion)};
}

export async function readDeploymentReleaseReceipt({db,request,grantId=null}={}){
 const input=normalizeDeploymentReceiptRequest(request);
 if(!input||typeof db?.query!=='function'||
   (grantId!==null&&!GRANT.test(grantId)))return held('request-invalid');
 const result=await db.query(`SELECT r.id AS "receiptId",r.receipt_key AS "receiptKey",
  r.target,r.source_sha AS "sourceSha",r.artifact_digest AS "artifactDigest",
  r.manifest_file_count AS "manifestFileCount",
  r.independent_readback AS "independentReadback",r.grant_id AS "grantId",
  r.profile_version AS "profileVersion",r.stop_version AS "stopVersion"
  FROM brain_deployment_release_receipts r
  JOIN brain_authority_grants g ON g.grant_id=r.grant_id
  WHERE r.receipt_key=$1 AND ($2::text IS NULL OR r.grant_id=$2)
   AND g.actor='mcp:ultron' AND g.objective_id=r.receipt_key
   AND g.operation='cloud.deploy' AND g.policy_sha=r.policy_sha
   AND g.resource='hatchable:deployment:proj_A6GCXRSKizko:'||r.target||':'||
    r.artifact_digest||':source:'||r.source_sha
   AND r.policy_sha=$3 LIMIT 2`,
  [input.key,grantId,DEPLOYMENT_RECEIPT_POLICY_SHA]);
 const rows=result?.rows||[];
 if(rows.length!==1)return rows.length>1?held('receipt-ambiguous'):
  uncertain('receipt-not-observed');
 const row=rows[0];
 if(row.target!==input.target||row.sourceSha!==input.sourceSha||
   row.artifactDigest!==input.artifactDigest||
   Number(row.manifestFileCount)!==input.manifestFileCount||
   row.independentReadback!==true)return held('receipt-conflict');
 return deploymentReceiptPublicResult(row);
}

export async function findDeploymentReleaseReceipt({db,sourceSha}={}){
 if(typeof db?.query!=='function'||!SHA.test(sourceSha||''))return null;
 const result=await db.query(`SELECT r.id,r.target,r.source_sha,r.artifact_digest,
  r.manifest_file_count,r.independent_readback,r.grant_id
  FROM brain_deployment_release_receipts r
  JOIN brain_authority_grants g ON g.grant_id=r.grant_id
  WHERE r.source_sha=$1 AND r.independent_readback
   AND g.actor='mcp:ultron' AND g.objective_id=r.receipt_key
   AND g.operation='cloud.deploy' AND g.policy_sha=r.policy_sha
   AND g.resource='hatchable:deployment:proj_A6GCXRSKizko:'||r.target||':'||
    r.artifact_digest||':source:'||r.source_sha
   AND r.policy_sha=$2
  ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,
  [sourceSha,DEPLOYMENT_RECEIPT_POLICY_SHA]);
 return result?.rows?.[0]??null;
}

export function deploymentArtifactDigest(files){
 if(!Array.isArray(files)||!files.length)throw Error('deployment-files-invalid');
 const normalized=files.map(file=>{
  if(!file||typeof file.path!=='string'||!file.path||
    typeof file.hash!=='string'||!/^[a-f0-9]{64}$/.test(file.hash))
    throw Error('deployment-files-invalid');
  return {path:file.path,hash:file.hash};
 }).sort((a,b)=>a.path.localeCompare(b.path));
 if(new Set(normalized.map(x=>x.path)).size!==normalized.length)
  throw Error('deployment-files-invalid');
 return 'sha256:'+createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
