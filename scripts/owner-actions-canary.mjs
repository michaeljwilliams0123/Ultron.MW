/** Manual owner-dispatched Actions canary. Not a Coordinator or signed Task 1–5 identity. */
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const REPO='michaeljwilliams0123/Ultron.MW',REPO_ID=1424939667;
const OWNER='michaeljwilliams0123',API='https://api.github.com/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/,RUN_ID=/^[1-9][0-9]{0,15}$/;
const PHRASE='APPROVE_ONE_OWNER_ACTIONS_CANARY';
const actor='github-actions[bot]';

function receipt(env,mode,status,reason,extra={}){
 const run=RUN_ID.test(env?.GITHUB_RUN_ID||'')?env.GITHUB_RUN_ID:null;
 return Object.freeze({schema:'ultron.owner-actions-canary.v1',
  status,reason,operation:mode==='create'?'branch.create':'repository.read',
  repository:REPO,repositoryId:REPO_ID,
  ownerDispatcher:OWNER,executionPrincipal:actor,
  identityScheme:'github-actions-owner-dispatch-not-GitHub-App',
  appPrincipalsVerified:0,councilRolesVerified:0,postgresReceiptVerified:false,
  runId:run,sourceSha:SHA.test(env?.GITHUB_SHA||'')?env.GITHUB_SHA:null,
  branch:mode==='create'&&run?'ultron/canary-owner-actions-'+run:null,
  externalWritePerformed:false,writeAttempted:false,writeOutcomeUncertain:false,
  remoteReadbackVerified:false,...extra});
}
const validEnv=env=>env?.GITHUB_ACTIONS==='true'&&
 env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_REPOSITORY===REPO&&
 env.GITHUB_ACTOR===OWNER&&env.GITHUB_TRIGGERING_ACTOR===OWNER&&
 env.GITHUB_REF==='refs/heads/main'&&SHA.test(env.GITHUB_SHA||'')&&
 RUN_ID.test(env.GITHUB_RUN_ID||'')&&env.GITHUB_RUN_ATTEMPT==='1';
const sameRef=(obj,ref,sha)=>obj?.ref==='refs/heads/'+ref&&
 obj.object?.type==='commit'&&obj.object.sha===sha;

export async function runOwnerActionsCanary({
 env={},mode='read',expectedSha='',approvalPhrase='',request=globalThis.fetch
}={}){
 const held=(reason,extra)=>receipt(env,mode,'held',reason,extra);
 if(!['read','create'].includes(mode)||!validEnv(env))
  return held('owner-workflow-dispatch-required');
 if(mode==='create'&&
  (approvalPhrase!==PHRASE||expectedSha!==env.GITHUB_SHA))
  return held('explicit-canary-approval-and-exact-source-required');
 if(typeof env.GITHUB_TOKEN!=='string'||env.GITHUB_TOKEN.length<8||
   /[\r\n]/.test(env.GITHUB_TOKEN)||typeof request!=='function')
  return held('trusted-actions-token-unavailable');
 const headers={Authorization:'Bearer '+env.GITHUB_TOKEN,
  Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'Ultron-Owner-Actions-Canary'};
 const get=async path=>{
  let response;
  try{response=await request(API+path,{method:'GET',redirect:'error',
   signal:AbortSignal.timeout(10000),headers});}
  catch{return null;}
  if(response?.status===404)return {status:404};
  if(!response?.ok||response.status!==200)return null;
  try{return {status:200,body:await response.json()};}
  catch{return null;}
 };
 const repo=await get('');
 if(repo?.status!==200||repo.body?.id!==REPO_ID||
   repo.body.full_name!==REPO||repo.body.default_branch!=='main')
  return held('canonical-repository-readback-denied');
 const main=await get('/git/ref/heads/main');
 if(main?.status!==200||!sameRef(main.body,'main',env.GITHUB_SHA))
  return held('exact-main-head-not-verified');
 if(mode==='read')
  return receipt(env,mode,'verified','owner-actions-repository-and-head-readback',{
   remoteReadbackVerified:true,
   receiptDigest:createHash('sha256').update(JSON.stringify([
    'ultron.owner-actions-canary.v1','read',REPO_ID,env.GITHUB_RUN_ID,env.GITHUB_SHA
   ])).digest('hex')});

 const branch='ultron/canary-owner-actions-'+env.GITHUB_RUN_ID;
 const existing=await get('/git/ref/heads/'+branch);
 if(existing?.status!==404)return held(existing?.status===200?
  'canary-branch-preexists-reconcile-required':'canary-branch-preflight-unavailable');
 // Exactly one POST. Unknown outcomes require reconciliation, never blind retry.
 let post;
 try{post=await request(API+'/git/refs',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
  headers:{...headers,'Content-Type':'application/json'},
  body:JSON.stringify({ref:'refs/heads/'+branch,sha:env.GITHUB_SHA})
 });}catch{return held('github-write-outcome-uncertain',{
  writeAttempted:true,writeOutcomeUncertain:true});}
 if(!post?.ok||post.status!==201)
  return held('github-ref-write-denied-or-uncertain',{
   writeAttempted:true,writeOutcomeUncertain:post?.status!==403});
 let committed;
 try{committed=await post.json();}catch{
  return held('github-write-response-unverified',
   {writeAttempted:true,writeOutcomeUncertain:true});}
 if(!sameRef(committed,branch,env.GITHUB_SHA))
  return held('github-write-response-unverified',
   {writeAttempted:true,writeOutcomeUncertain:true});
 const observed=await get('/git/ref/heads/'+branch);
 const lastMain=await get('/git/ref/heads/main');
 if(observed?.status!==200||!sameRef(observed.body,branch,env.GITHUB_SHA)||
  lastMain?.status!==200||!sameRef(lastMain.body,'main',env.GITHUB_SHA))
  return held('post-write-readback-or-main-lineage-unverified',{
   writeAttempted:true,writeOutcomeUncertain:true});
 return receipt(env,mode,'verified','isolated-branch-provider-readback',{
  writeAttempted:true,externalWritePerformed:true,remoteReadbackVerified:true,
  receiptDigest:createHash('sha256').update(JSON.stringify([
   'ultron.owner-actions-canary.v1','create',REPO_ID,
   env.GITHUB_RUN_ID,env.GITHUB_SHA,branch
  ])).digest('hex')});
}
async function cli(){
 const env=process.env,mode=env.OWNER_CANARY_MODE||'read';
 const result=await runOwnerActionsCanary({env,mode,
  expectedSha:env.OWNER_CANARY_EXPECTED_SHA||'',
  approvalPhrase:env.OWNER_CANARY_APPROVAL_PHRASE||''});
 await mkdir('artifacts',{recursive:true});
 const id=RUN_ID.test(env.GITHUB_RUN_ID||'')?env.GITHUB_RUN_ID:'held';
 await writeFile(resolve('artifacts/owner-actions-canary-'+id+'.json'),
  JSON.stringify(result,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
 console.log('Owner Actions canary:',result.status,'operation:',result.operation,
  'reason:',result.reason,'remoteReadback:',result.remoteReadbackVerified,
  'appPrincipals:',result.appPrincipalsVerified,
  'postgresReceipt:',result.postgresReceiptVerified);
 if(result.status!=='verified')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await cli();}catch{
  console.error('Owner Actions canary held: runtime-or-artifact-error');
  process.exitCode=2;
 }
}
