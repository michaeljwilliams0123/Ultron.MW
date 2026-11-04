import {db,events} from 'hatchable';
import {readExecutionControl} from 'lib/runtime-control.js';
import {readOwnerProfile} from 'lib/owner-autonomy-control.js';
import {verifyC06ModelRun} from 'lib/c06-live-evidence.js';
import {notifyOwner} from 'lib/owner-live-events.js';

// A model-origin evaluation canary, NOT a model-authorized GitHub write or
// an automatic production release. Protected owner identity is authoritative.
export const access='admin';
export const methods=['GET','POST'];
const OWNER='michaeljwilliams0123';
const KEY=/^c06-[a-z0-9-]{8,70}$/;
const GET_SQL=`SELECT id,task_key,stop_version,owner,provider_run_id,source_sha,
 artifact_id,artifact_digest,model_decision,paid_cents,evidence_type,
 created_at FROM c06_live_receipts ORDER BY id DESC LIMIT 8`;
const BY_KEY=`SELECT id,task_key,stop_version,provider_run_id,source_sha,
 artifact_id,artifact_digest,model_decision,paid_cents,evidence_type,
 created_at FROM c06_live_receipts WHERE task_key=$1`;
const INSERT=`INSERT INTO c06_live_receipts
 (task_key,stop_version,owner,provider_run_id,source_sha,
  artifact_id,artifact_digest,model_decision,paid_cents,evidence_type)
 SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
 FROM brain_runtime_control c
 JOIN brain_owner_autonomy_profile a ON a.id=1
 WHERE c.id=1 AND c.version=$2 AND c.paused=false
   AND a.owner=$3 AND a.max_paid_cents=0
   AND (SELECT count(*) FROM c06_live_receipts
        WHERE created_at > now()-interval '1 hour')<12
 ON CONFLICT(task_key) DO NOTHING
 RETURNING id,task_key,stop_version,provider_run_id,source_sha,
  artifact_id,artifact_digest,model_decision,paid_cents,evidence_type,created_at`;
function answer(res,status,body){
 return res.status(status).json({schema:'ultron.c06-live-canary.v1',...body});
}
function same(row,version,evidence){
 return row&&Number(row.stop_version)===version&&
  Number(row.provider_run_id)===evidence.runId&&
  row.source_sha===evidence.sourceSha&&
  Number(row.artifact_id)===evidence.artifactId&&
  row.artifact_digest===evidence.artifactDigest&&
  row.model_decision===evidence.modelDecision&&Number(row.paid_cents)===0;
}
export default async function(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.member?.handle!==OWNER)
  return answer(res,403,{ok:false,error:'owner-identity-required'});
 if(req.method==='GET'){
  try{
   const result=await db.query(GET_SQL);
   return answer(res,200,{ok:true,rows:result.rows||[],productionAccepted:false});
  }catch{
   return answer(res,503,{ok:false,error:'receipt-read-unavailable'});
  }
 }
 const raw=req.body;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  Object.keys(raw).length!==3||raw.action!=='evaluate'||
  !KEY.test(raw.key||'')||
  !Number.isSafeInteger(raw.expectedStopVersion)||raw.expectedStopVersion<1)
  return answer(res,400,{ok:false,error:'invalid-owner-canary-request'});
 const key=raw.key,version=raw.expectedStopVersion;
 let prior;
 try{prior=(await db.query(BY_KEY,[key])).rows?.[0];}
 catch{return answer(res,503,{ok:false,error:'receipt-read-unavailable'});}
 if(prior){
  return Number(prior.stop_version)===version?
   answer(res,200,{ok:true,reused:true,row:prior,productionAccepted:false}):
   answer(res,409,{ok:false,error:'idempotency-conflict'});
 }
 let control,profile;
 try{
  [control,profile]=await Promise.all([
   readExecutionControl({db}),readOwnerProfile({db})
  ]);
 }catch{return answer(res,503,{ok:false,error:'owner-control-unavailable'});}
 if(control.paused||control.version!==version||profile.paused||
  profile.maxPaidCents!==0||profile.owner!==OWNER)
  return answer(res,409,{ok:false,error:'owner-stop-or-version-held'});
 const verified=await verifyC06ModelRun();
 if(!verified.ok)
  return answer(res,verified.reason==='github-readback-unavailable'?503:422,
   {ok:false,error:verified.reason,productionAccepted:false});
 const params=[key,version,OWNER,verified.runId,verified.sourceSha,
  verified.artifactId,verified.artifactDigest,verified.modelDecision,
  verified.paidCents,verified.proof];
 let inserted=null,writeUncertain=false;
 try{inserted=(await db.query(INSERT,params)).rows?.[0]||null;}
 catch{writeUncertain=true;}
 let readback;
 try{readback=(await db.query(BY_KEY,[key])).rows?.[0]||null;}
 catch{return answer(res,503,{ok:false,error:'receipt-readback-unavailable'});}
 if(!same(readback,version,verified))
  return answer(res,writeUncertain?503:409,{ok:false,error:'canary-commit-unconfirmed'});
 if(inserted)await notifyOwner(events,'task',Number(readback.id));
 return answer(res,inserted?201:200,{
  ok:true,reused:!inserted,reconciled:writeUncertain,
  row:readback,productionAccepted:false,
  evidence:verified.proof
 });
}
