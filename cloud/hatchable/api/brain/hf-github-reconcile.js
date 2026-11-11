import {db,events} from 'hatchable';
import {compareGithubRun,selectArtifactMetadata,mainContainsSource,mainComparePath}
 from 'lib/hf-github-receipts.js';
import {notifyOwner} from 'lib/owner-live-events.js';
export const access='scheduler';
export const methods=['POST'];
const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const HEADERS={Accept:'application/vnd.github+json','User-Agent':'Ultron-HF-Signed-Receipt'};
async function github(path){
 const resp=await fetch(API+path,{
  method:'GET',headers:HEADERS,signal:AbortSignal.timeout(6000)
 });
 if(!resp.ok)throw Error(resp.status===403||resp.status===429?
  'provider-rate-limited':'provider-unavailable');
 return resp.json();
}
// Owner HMAC intake schedules this platform-authenticated worker. No PR or
// external write is issued here; never execute model-generated source.
export default async function(_req,res){
 const claimToken=crypto.randomUUID();
 let row;
 try{
  const r=await db.query(`UPDATE hf_github_receipts
    SET claim_token=$1,lease_until=now()+interval '30 seconds',
      verification_attempts=verification_attempts+1,updated_at=now()
    WHERE id=(SELECT id FROM hf_github_receipts
      WHERE state IN ('pending','retry') AND lease_until<now()
        AND next_attempt_at<=now() AND verification_attempts<3
      ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,run_id,run_attempt,workflow_key,source_sha,conclusion,claim_token`,
    [claimToken]);
  row=r.rows?.[0];
 }catch{return res.status(503).json({ok:false,error:'receipt-claim-unavailable'});}
 if(!row)return res.json({ok:true,result:'no-due-receipt'});
 const event={runId:Number(row.run_id),runAttempt:Number(row.run_attempt),
  workflowKey:row.workflow_key,sourceSha:row.source_sha,conclusion:row.conclusion};
 let run,artifacts;
 try{
  run=await github('/actions/runs/'+event.runId);
  let mismatch=compareGithubRun(event,run).verified?null:'independent-source-mismatch';
  // A run whose commit is not on main (for example a tag named main) is never
  // verified evidence, whatever its head_branch says.
  if(!mismatch&&!mainContainsSource(await github(mainComparePath(event.sourceSha)),event.sourceSha))
   mismatch='source-not-on-main';
  if(mismatch){
   const held=await db.query(`UPDATE hf_github_receipts
    SET state='held',failure_code=$3,
     claim_token=NULL,lease_until=to_timestamp(0),updated_at=now()
    WHERE id=$1 AND claim_token=$2 RETURNING id`,[row.id,claimToken,mismatch]);
   if(held.rows?.length)await notifyOwner(events,'github');
   return res.json({ok:true,result:held.rows?.length?
    (mismatch==='source-not-on-main'?'held-source-not-on-main':'held-source-mismatch'):'claim-lost'});
  }
  const response=await github('/actions/runs/'+event.runId+'/artifacts?per_page=100');
  if(!Array.isArray(response?.artifacts))throw Error('artifact-metadata-unavailable');
  artifacts=selectArtifactMetadata(event.workflowKey,event.runId,response.artifacts,event.sourceSha);
 }catch(error){
  const reason=['provider-rate-limited','artifact-metadata-unavailable'].includes(error?.message)?
   error.message:'provider-unavailable';
  try{
   const result=await db.query(`UPDATE hf_github_receipts
    SET state=CASE WHEN verification_attempts>=3 THEN 'held' ELSE 'retry' END,
     failure_code=$3,claim_token=NULL,lease_until=to_timestamp(0),
     next_attempt_at=now()+verification_attempts*interval '15 minutes',
     updated_at=now()
    WHERE id=$1 AND claim_token=$2 RETURNING state`,[row.id,claimToken,reason]);
   if(result.rows?.[0]?.state==='held')await notifyOwner(events,'github');
  }catch{return res.status(503).json({ok:false,error:'reconcile-update-unconfirmed'});}
  return res.json({ok:false,result:'retry-or-held',reason});
 }
 let saved;
 try{
  const result=await db.query(`UPDATE hf_github_receipts
   SET state='verified',artifact_evidence=$3::jsonb,
     github_verified_at=now(),failure_code=NULL,
     claim_token=NULL,lease_until=to_timestamp(0),updated_at=now()
   WHERE id=$1 AND claim_token=$2
   RETURNING id`,[row.id,claimToken,JSON.stringify(artifacts)]);
  saved=result.rows?.[0];
 }catch{return res.status(503).json({ok:false,error:'verification-commit-unconfirmed'});}
 if(saved)await notifyOwner(events,'github');
 return res.json({ok:true,result:saved?'verified-source-metadata':'claim-lost',
  runId:event.runId,artifactCount:artifacts.length,
  // Content hashes are only reported when returned by the GitHub artifact API;
  // these are metadata observations, not independently downloaded ZIP bytes.
  evidence:'github-run-and-artifact-metadata'});
}
