import {evaluateC06OwnerEffect} from './c06-owner-safe.js';
// Immutable evidence from owner-dispatched model generation and its archived
// GitHub Actions artifact, not a fresh billable inference request.
export const C06_RUN=41775191071;
export const C06_SOURCE='e2dda037f6d0512abf66d5a9666f98c1d62f2f92';
export const C06_ARTIFACT_ID=13295973797;
const C06_ARTIFACT_DIGEST='sha256:51a777be41c5b988127f72bb335c6ace45caf6c09d6b7316d5111cc9705ea5aa';
const GH='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const headers={Accept:'application/vnd.github+json','User-Agent':'Ultron-C06-live-receipt'};
function hold(reason){return {ok:false,modelDecision:'held',reason,productionAccepted:false,paidCents:0};}
async function json(fetchGithub,path){
 const response=await fetchGithub(GH+path,{method:'GET',cache:'no-store',headers,
   signal:AbortSignal.timeout(8000)});
 if(!response?.ok)throw Error('github-readback-unavailable');
 return response.json();
}
export async function verifyC06ModelRun({fetchGithub=fetch}={}){
 let run,artifacts;
 try{
  [run,artifacts]=await Promise.all([
   json(fetchGithub,'/actions/runs/'+C06_RUN),
   json(fetchGithub,'/actions/runs/'+C06_RUN+'/artifacts?per_page=100')
  ]);
 }catch{return hold('github-readback-unavailable');}
 const valid=run?.id===C06_RUN&&run?.run_attempt===1&&
  run?.path==='.github/workflows/c06-owner-model-release.yml'&&
  run?.event==='workflow_dispatch'&&run?.status==='completed'&&
  run?.conclusion==='success'&&run?.head_sha===C06_SOURCE&&
  run?.head_branch==='main'&&run?.actor?.login==='michaeljwilliams0123'&&
  run?.repository?.full_name==='michaeljwilliams0123/Ultron.MW'&&
  run?.repository?.private===false;
 if(!valid)return hold('unverified-source');
 const match=Array.isArray(artifacts?.artifacts)?artifacts.artifacts.filter(a=>
  a?.id===C06_ARTIFACT_ID&&a.name==='c06-model-output-'+C06_RUN&&
  a.expired===false&&a.size_in_bytes===3129&&
  a.digest===C06_ARTIFACT_DIGEST):[];
 if(match.length!==1)return hold('unverified-artifact');
 const modelDecision=evaluateC06OwnerEffect({
  authorized:true,paused:false,paidCents:0,
  providerStatus:'observed',receiptVerified:true
 });
 if(modelDecision!=='verified')return hold('model-decision-held');
 return {ok:true,modelDecision,runId:C06_RUN,sourceSha:C06_SOURCE,
  artifactId:C06_ARTIFACT_ID,artifactDigest:C06_ARTIFACT_DIGEST,
  proof:'independent-github-run-and-artifact-metadata',
  productionAccepted:false,paidCents:0};
}
