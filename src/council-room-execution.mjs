import {createHash} from 'node:crypto';
import {appendFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {githubReadWithRecovery,githubRequest,launchIssueCommentPr,
  PR_OWNER,PR_REPOSITORY} from './cloud-pr.mjs';
import {dispatchAndObserveVerify,observeVerifyRun} from './pr-brain-verify.mjs';

const API='https://ultron-mw-cloud.hatchable.site/api/brain/council-room-execution';
const SHA=/^[a-f0-9]{40}$/;
const SECRET_LIKE=/(?:password|passcode|otp|api[_ -]?key|private[_ -]?key)\s*[:=]|\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i;

export function parseOwnerImplementationComment(event,actor,repository){
 const issue=event?.issue,comment=event?.comment;
 if(repository!==PR_REPOSITORY||actor!==PR_OWNER||event?.action!=='created'||
   issue?.user?.login!==PR_OWNER||issue?.state!=='open'||issue?.pull_request||
   !Number.isSafeInteger(issue?.number)||issue.number<1||
   comment?.user?.login!==PR_OWNER||!Number.isSafeInteger(comment?.id)||comment.id<1||
   typeof comment.body!=='string')throw Error('owner-implementation-comment-invalid');
 const match=comment.body.match(/^\s*@ultron implement ([^\r\n]+)\s*$/i);
 const objective=match?.[1]?.trim();
 if(!objective||objective.length<5||objective.length>1000||
   /[\u0000-\u001f]/.test(objective)||SECRET_LIKE.test(objective))
  throw Error('owner-implementation-objective-invalid');
 const digest=createHash('sha256').update(
  JSON.stringify({issueNumber:issue.number,objective})).digest('hex');
 return Object.freeze({issueNumber:issue.number,commentId:comment.id,
  commentBody:comment.body,objective,digest,
  idempotencyKey:'room:issue:'+issue.number+':'+digest.slice(0,40)});
}

function callbackBase(request){
 return {schema:'ultron.council-room.execution.v1',
  issueNumber:request.issueNumber,commentId:request.commentId,
  commentBody:request.commentBody};
}

export async function postExecutionReceipt(payload,{
  requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
  requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  transport=fetch,url=API
}={}){
 if(typeof requestUrl!=='string'||typeof requestToken!=='string'||
   typeof transport!=='function')throw Error('github-oidc-unavailable');
 const raw=JSON.stringify(payload);
 const audience='ultron.council-room.execution.v1:sha256:'+
  createHash('sha256').update(raw).digest('hex');
 const identityUrl=new URL(requestUrl);
 identityUrl.searchParams.set('audience',audience);
 const identityResponse=await transport(identityUrl,{
  headers:{authorization:'Bearer '+requestToken}
 });
 if(!identityResponse.ok)throw Error('github-oidc-request-failed:'+identityResponse.status);
 const identity=await identityResponse.json();
 if(typeof identity?.value!=='string')throw Error('github-oidc-token-missing');
 const response=await transport(url,{method:'POST',
  headers:{authorization:'Bearer '+identity.value,'content-type':'application/json'},
  body:raw});
 const result=await response.json();
 if(!response.ok||result?.ok!==true)
  throw Error('hatchable-execution-receipt-failed:'+
   (typeof result?.error==='string'?result.error:'invalid-response'));
 return result;
}

async function observeArtifact({request,event,actor,repository,executorSha,
  get, getOptional,post,put,observeExactHead}){
 return launchIssueCommentPr({event,actor,repository,executorSha,get,getOptional,
  post,put,readOnly:true,observeExactHead});
}

// A green CI run on a documentation-only proposal is transport/source evidence,
// not proof that an implementation worker changed code or completed the objective.
function proposalDisposition(verification){
 if(verification?.state!=='completed')return {phase:'observing'};
 if(verification.conclusion==='success')return {phase:'needs-owner',reason:'proposal-only-no-execution'};
 return {phase:'blocked',reason:'exact-head-verify-'+String(verification.conclusion||'unverified')};
}

export async function runCouncilRoomExecution({
 event,actor,repository,executorSha,
 github={get:p=>githubReadWithRecovery(p),
  getOptional:p=>githubReadWithRecovery(p,{optional:true}),
  post:(p,body)=>githubRequest(p,{method:'POST',body}),
  put:(p,body)=>githubRequest(p,{method:'PUT',body})},
 callback=postExecutionReceipt,
 verifyExactHead=dispatchAndObserveVerify,observeExactHead=observeVerifyRun
}={}){
 const request=parseOwnerImplementationComment(event,actor,repository);
 if(!SHA.test(executorSha||''))throw Error('trusted-main-executor-required');
 const base=callbackBase(request);
 const first=await callback({...base,phase:'planned'});
 let job=first.job;
 let freshDispatch=false;
 if(!job)throw Error('hatchable-execution-job-missing');
 if(['verified','blocked'].includes(job.state))return {status:job.state,
  job,requestKey:request.idempotencyKey,replayed:true};
 if(job.state==='needs-owner'&&job.result?.reason!=='owner-paused')
  return {status:'needs-owner',job,requestKey:request.idempotencyKey,replayed:true};

 if(job.state==='planned'||job.state==='needs-owner'){
  const reserved=await callback({...base,phase:'reserve'});
  job=reserved.job;
  if(!job)throw Error('hatchable-execution-reservation-missing');
  freshDispatch=reserved.dispatchAdmitted===true&&job.state==='dispatching';
  if(job.state==='needs-owner')return {status:'needs-owner',job,
   requestKey:request.idempotencyKey,replayed:true};
 }

 const common={event,actor,repository,executorSha,...github,
  observeExactHead};
 if(job.state==='planned'){
  await callback({...base,phase:'needs-owner',result:{reason:'execution-reservation-not-confirmed'}});
  return {status:'needs-owner',requestKey:request.idempotencyKey};
 }

 if(job.state==='dispatching'&&!freshDispatch){
  const found=await observeArtifact({...common,request});
  if(found.status==='not-found'){
   const held=await callback({...base,phase:'needs-owner',
    result:{reason:'artifact-write-outcome-uncertain'}});
   return {status:'needs-owner',job:held.job,requestKey:request.idempotencyKey};
  }
  const artifact={kind:'pull_request',id:found.prNumber,url:found.prUrl,
   branch:found.branch,headSha:found.headSha};
  await callback({...base,phase:'dispatched',artifact});
  job={...job,state:'dispatched',externalId:String(artifact.id),
   externalUrl:artifact.url};
  if(found.verification?.state==='pending'&&found.verification.runId){
   const observing=await callback({...base,phase:'observing'});
   return {status:'observing',job:observing.job,
    verification:found.verification,requestKey:request.idempotencyKey,
    replayed:true};
  }
 }

 if((job.state==='dispatching'&&!freshDispatch)||job.state==='dispatched'){
  const found=await observeArtifact({...common,request});
  if(found.status==='not-found'){
   const held=await callback({...base,phase:'needs-owner',
    result:{reason:'artifact-readback-required'}});
   return {status:'needs-owner',job:held.job,requestKey:request.idempotencyKey};
  }
  if(job.state==='dispatched'&&found.verification?.state==='completed'){
   await callback({...base,phase:'observing'});
   const {phase,reason}=proposalDisposition(found.verification);
   const saved=await callback({...base,phase,
    verification:{runId:found.verification.runId,url:found.verification.url,
     sha:found.verification.sha,conclusion:found.verification.conclusion},
    ...(reason?{result:{reason}}:{})});
   return {status:phase,job:saved.job,requestKey:request.idempotencyKey,replayed:true};
  }
  if(found.verification?.state==='pending'&&found.verification.runId){
   const observing=await callback({...base,phase:'observing'});
   return {status:'observing',job:observing.job,
    verification:found.verification,requestKey:request.idempotencyKey,
    replayed:true};
  }
  await callback({...base,phase:'observing'});
  const verification=await verifyExactHead({get:github.get,post:github.post,
   branch:found.branch,headSha:found.headSha});
  const {phase,reason}=proposalDisposition(verification);
  const saved=await callback({...base,phase,
   ...(verification.runId?{verification:{
    runId:verification.runId,url:verification.url,sha:verification.sha,
    conclusion:verification.conclusion}}:{}),
   ...(reason?{result:{reason}}:{})});
  return {status:phase,job:saved.job,verification,
   requestKey:request.idempotencyKey,replayed:found.status==='already-created'};
 }

 if(job.state==='observing'){
  const found=await observeArtifact({...common,request});
  if(found.status==='not-found'){
   const held=await callback({...base,phase:'needs-owner',
    result:{reason:'artifact-readback-required'}});
   return {status:'needs-owner',job:held.job,requestKey:request.idempotencyKey};
  }
  const verification=found.verification;
  if(verification?.state!=='completed')return {status:'observing',job,
   verification,requestKey:request.idempotencyKey,replayed:true};
  const {phase,reason}=proposalDisposition(verification);
  const saved=await callback({...base,phase,verification:{
   runId:verification.runId,url:verification.url,sha:verification.sha,
   conclusion:verification.conclusion},
   ...(reason?{result:{reason}}:{})});
  return {status:phase,job:saved.job,verification,
   requestKey:request.idempotencyKey,replayed:true};
 }

 if(job.state==='dispatched'){
  return {status:'needs-owner',job,requestKey:request.idempotencyKey,
   reason:'execution-state-unrecognized'};
 }

 try{
  const result=await launchIssueCommentPr({
   event,actor,repository,executorSha,...github,verifyExactHead,observeExactHead,
   onArtifact:async pr=>callback({...base,phase:'dispatched',artifact:{
    kind:'pull_request',id:pr.number,url:pr.html_url,branch:pr.head.ref,
    headSha:pr.head.sha}}),
   onBeforeVerify:async()=>callback({...base,phase:'observing'}),
  });
  let verification=result.verification;
  if(result.status==='already-created'&&verification?.state!=='completed'&&
     !verification?.runId){
   await callback({...base,phase:'observing'});
   verification=await verifyExactHead({get:github.get,post:github.post,
    branch:result.branch,headSha:result.headSha});
  }
  const {phase,reason}=proposalDisposition(verification);
  const saved=await callback({...base,phase,
   ...(verification?.runId?{verification:{
    runId:verification.runId,url:verification.url,sha:verification.sha,
    conclusion:verification.conclusion}}:{}),
   ...(reason?{result:{reason}}:{})});
  return {status:phase,job:saved.job,prUrl:result.prUrl,
   verification,requestKey:request.idempotencyKey,created:result.created};
 }catch(error){
  await callback({...base,phase:'needs-owner',
   result:{reason:'execution-outcome-requires-readback'}});
  throw error;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  const result=await runCouncilRoomExecution({event,actor:process.env.GITHUB_ACTOR,
   repository:process.env.GITHUB_REPOSITORY,executorSha:process.env.GITHUB_SHA});
  if(process.env.GITHUB_STEP_SUMMARY)
   await appendFile(process.env.GITHUB_STEP_SUMMARY,
    '## Council Room GitHub handoff\n\nState: '+result.status+
    '\nRequest key: '+result.requestKey+
    (result.prUrl?'\nPull request: '+result.prUrl:'')+
    (result.verification?.url?'\nExact-head Verify: '+result.verification.url:'')+
    '\nPaid spend: $0. No automatic merge or deployment.\n');
  console.log(JSON.stringify({status:result.status,requestKey:result.requestKey,
   prUrl:result.prUrl||result.job?.externalUrl||null,
   verification:result.verification||null}));
 }catch(error){
  console.error('Council Room execution handoff failed: '+error.message);
  process.exitCode=1;
 }
}
