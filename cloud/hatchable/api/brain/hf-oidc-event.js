import {db,scheduler,events} from 'hatchable';
import {verifyGitHubOidc} from 'lib/github-oidc-bridge.js';
import {validateGithubWorkflowPayload,admitGithubDelivery} from 'lib/hf-github-receipts.js';
import {notifyOwner} from 'lib/owner-live-events.js';
// The endpoint accepts short-lived GitHub-signed OIDC workflow identity.
// No long-lived secret or unauthenticated external write is required.
// Positive delivery is only a durable receipt; a separate worker checks GitHub
// source + artifact metadata again before lab promotion to "verified".
export const access='public';
export const methods=['POST'];
const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
function answer(res,status,ok,error,other={}){
 return res.status(status).json({schema:'ultron.hf-oidc-ingress.v1',ok,
  ...(!ok?{error}:{}),...other});
}
export default async function(req,res){
 let raw=null;
 if(typeof req.rawBody==='string')raw=req.rawBody;
 else if(req.rawBody instanceof Uint8Array){
  try{raw=new TextDecoder('utf-8',{fatal:true}).decode(req.rawBody);}
  catch{raw=null;}
 }
 const header=req.headers?.authorization||req.headers?.Authorization;
 if(typeof raw!=='string'||raw.length>2048||
    typeof header!=='string'||!/^Bearer [A-Za-z0-9._-]{250,8000}$/.test(header))
  return answer(res,403,false,'oidc-not-authenticated');
 let verified;
 try{
  verified=await verifyGitHubOidc({
   token:header.slice(7),rawBody:raw
  });
 }catch{return answer(res,403,false,'oidc-not-authenticated');}
 let run;
 try{
  const response=await fetch(API+'/actions/runs/'+verified.runId,{
   method:'GET',headers:{Accept:'application/vnd.github+json','User-Agent':'Ultron-OIDC-Model-Bridge'},
   signal:AbortSignal.timeout(6500)
  });
  if(!response.ok)throw Error('github-readback-unavailable');
  run=await response.json();
 }catch{return answer(res,503,false,'github-readback-unavailable');}
 let event;
 try{
  event=validateGithubWorkflowPayload({
   action:'completed',repository:run.repository,workflow_run:run
  });
  if(event.runAttempt!==verified.runAttempt||event.runId!==verified.runId)
   throw Error('source-run-mismatch');
 }catch{return answer(res,422,false,'unsupported-github-run');}
 let receipt;
 try{
  receipt=await admitGithubDelivery({
   db,deliveryId:verified.deliveryId,event,
   payloadSha256:verified.payloadSha256
  });
 }catch(error){
  return answer(res,error?.message==='delivery-id-conflict'?409:503,
   false,error?.message==='delivery-id-conflict'?
   'delivery-id-conflict':'receipt-admission-unavailable');
 }
 let scheduled=false;
 if(receipt.created){
  try{
   await scheduler.now('/api/brain/hf-github-reconcile',
    {via:'github-oidc-verified-receipt'});
   scheduled=true;
  }catch{scheduled=false}
  await notifyOwner(events,'github');
 }
 return answer(res,receipt.created?202:200,true,null,{
  status:receipt.created?'committed-awaiting-independent-reconciliation':'duplicate',
  runId:event.runId,runAttempt:event.runAttempt,scheduled,
  authentication:'github-oidc-signed-body'
 });
}
