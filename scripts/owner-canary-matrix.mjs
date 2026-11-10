/**
 * Owner Actions canary acceptance matrix.
 * Opt-in, isolated ref update; NOT an App token or signed Task 1-5 grant.
 */
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const REPO='Ultron-MW/Ultron.MW',REPO_ID=1424939667;
const OWNER='michaeljwilliams0123',ROOT='https://api.github.com/repos/'+REPO;
const RUN=/^[1-9][0-9]{0,15}$/,SHA=/^[0-9a-f]{40}$/;
const APPROVAL='APPROVE_ONE_CANARY_MARKER_COMMIT';
const MODES=new Set(['inspect','verify','marker']);
const digest=text=>createHash('sha256').update(text).digest('hex');
const blobSha=text=>createHash('sha1').update(
 'blob '+Buffer.byteLength(text)+'\0'+text).digest('hex');
const sameRef=(x,ref,sha)=>x?.ref==='refs/heads/'+ref&&
 x.object?.type==='commit'&&x.object.sha===sha;

export function markerDocument({targetRunId,markerRunId,sourceSha}){
 if(!RUN.test(String(targetRunId))||!RUN.test(String(markerRunId))||
  !SHA.test(String(sourceSha)))throw Error('invalid-marker-input');
 return JSON.stringify({
  schema:'ultron.owner-canary-marker.v1',repository:REPO,repositoryId:REPO_ID,
  targetBranch:'ultron/canary-owner-actions-'+targetRunId,
  sourceSha,markerWorkflowRunId:String(markerRunId),
  purpose:'single-file synthetic provenance canary; not a production release'
 })+'\n';
}
function makeReceipt({env,mode,targetRunId,expectedSha},status,reason,extra={}){
 const validTarget=RUN.test(String(targetRunId));
 return Object.freeze({
  schema:'ultron.owner-canary-matrix.v1',status,reason,
  operation:mode==='marker'?'branch.marker.commit':
   mode==='verify'?'branch.marker.verify':'branch.inspect',
  repository:REPO,repositoryId:REPO_ID,
  ownerDispatcher:OWNER,executionPrincipal:'github-actions[bot]',
  appPrincipalsVerified:0,councilRolesVerified:0,postgresReceiptVerified:false,
  signedTaskGrantVerified:false,
  workflowRunId:RUN.test(env?.GITHUB_RUN_ID||'')?env.GITHUB_RUN_ID:null,
  targetRunId:validTarget?String(targetRunId):null,
  branch:validTarget?'ultron/canary-owner-actions-'+targetRunId:null,
  markerPath:validTarget?'docs/canary/owner-actions-'+targetRunId+'.json':null,
  sourceSha:SHA.test(expectedSha||'')?expectedSha:null,
  writeAttempted:false,externalWritePerformed:false,
  remoteReadbackVerified:false,writeOutcomeUncertain:false,
  ...extra
 });
}
const validEnv=e=>e?.GITHUB_ACTIONS==='true'&&
 e.GITHUB_EVENT_NAME==='workflow_dispatch'&&e.GITHUB_REPOSITORY===REPO&&
 e.GITHUB_ACTOR===OWNER&&e.GITHUB_TRIGGERING_ACTOR===OWNER&&
 e.GITHUB_REF==='refs/heads/main'&&SHA.test(e.GITHUB_SHA||'')&&
 RUN.test(e.GITHUB_RUN_ID||'')&&e.GITHUB_RUN_ATTEMPT==='1';

export async function runOwnerCanaryMatrix({
 env={},mode='inspect',targetRunId='',markerRunId='',expectedSha='',
 approvalPhrase='',request=globalThis.fetch
}={}){
 const args={env,mode,targetRunId,expectedSha};
 const held=(reason,extra)=>makeReceipt(args,'held',reason,extra);
 const verified=(reason,extra)=>makeReceipt(args,'verified',reason,extra);
 const run=String(targetRunId),marker=String(markerRunId);
 if(!MODES.has(mode)||!validEnv(env)||!RUN.test(run)||
   !SHA.test(expectedSha)||expectedSha!==env.GITHUB_SHA)
  return held('owner-exact-source-and-target-required');
 if(mode==='marker'&&
  (approvalPhrase!==APPROVAL||marker!==env.GITHUB_RUN_ID||
   run===marker||env.OWNER_CANARY_STOP==='true'))
  return held('separate-marker-authorization-or-stop-denied');
 if(mode==='verify'&&(!RUN.test(marker)||marker===run))
  return held('verified-marker-run-id-required');
 if(typeof request!=='function'||typeof env.GITHUB_TOKEN!=='string'||
  env.GITHUB_TOKEN.length<8||/[\r\n]/.test(env.GITHUB_TOKEN))
  return held('trusted-actions-token-unavailable');

 const branch='ultron/canary-owner-actions-'+run;
 const markerPath='docs/canary/owner-actions-'+run+'.json';
 const headers={Authorization:'Bearer '+env.GITHUB_TOKEN,
  Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'Ultron-Owner-Canary-Matrix'};
 const send=async(method,path,body)=>{
  let response;
  try{response=await request(ROOT+path,{
   method,redirect:'error',signal:AbortSignal.timeout(10000),
   headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})
  });}catch{return {status:0};}
  const status=response?.status||0;
  if(!response?.ok)return {status};
  try{return {status,body:await response.json()};}
  catch{return {status:0};}
 };
 const get=path=>send('GET',path);
 const sameBranch=(value,sha)=>sameRef(value,'heads/'+branch,sha);
 // Refs include "refs/heads/<branch>", while sameRef takes a branch name.
 const refMatches=(value,sha)=>sameRef(value,branch,sha);
 const repo=await get('');
 if(repo.status!==200||repo.body?.id!==REPO_ID||
  repo.body?.full_name!==REPO||repo.body?.default_branch!=='main')
  return held('canonical-repository-id-not-verified');
 const main=await get('/git/ref/heads/main');
 if(main.status!==200||!sameRef(main.body,'main',expectedSha))
  return held('exact-main-source-sha-not-verified');
 const branchRef=await get('/git/ref/heads/'+branch);
 if(branchRef.status!==200||!SHA.test(branchRef.body?.object?.sha||'')||
   branchRef.body?.object?.type!=='commit'||
   branchRef.body?.ref!=='refs/heads/'+branch)
  return held('isolated-canary-ref-not-observed');
 const baseSha=branchRef.body.object.sha;
 if(mode==='inspect')
  return baseSha===expectedSha?
   verified('existing-canary-branch-and-main-readback',{
    remoteReadbackVerified:true,headSha:baseSha,
    receiptDigest:digest(JSON.stringify([REPO_ID,'inspect',run,expectedSha]))
   }):held('canary-branch-drift-from-source');

 async function verifyMarker(commitSha,markerRun){
  const text=markerDocument({targetRunId:run,markerRunId:markerRun,
   sourceSha:expectedSha});
  const gitCommit=await get('/git/commits/'+commitSha);
  if(gitCommit.status!==200||gitCommit.body?.sha!==commitSha||
   !SHA.test(gitCommit.body.tree?.sha||'')||
   gitCommit.body.tree.sha===baseTreeSha||
   gitCommit.body.parents?.length!==1||
   gitCommit.body.parents[0]?.sha!==expectedSha||
   gitCommit.body.message!=='test(canary): owner approved marker '+markerRun)
   return null;
  const content=await get('/contents/'+markerPath+'?ref='+commitSha);
  if(content.status!==200||content.body?.type!=='file'||
   content.body?.path!==markerPath||content.body?.encoding!=='base64'||
   content.body.size!==Buffer.byteLength(text)||
   content.body.sha!==blobSha(text))
   return null;
  let decoded;
  try{decoded=Buffer.from(content.body.content,'base64').toString('utf8');}
  catch{return null;}
  if(decoded!==text)return null;
  const compare=await get('/compare/'+expectedSha+'...'+commitSha);
  if(compare.status!==200||compare.body.ahead_by!==1||
   compare.body.total_commits!==1||
   compare.body.files?.length!==1||
   compare.body.files[0]?.filename!==markerPath||
   compare.body.files[0]?.status!=='added')
   return null;
  const latestRef=await get('/git/ref/heads/'+branch);
  const latestMain=await get('/git/ref/heads/main');
  if(latestRef.status!==200||!refMatches(latestRef.body,commitSha)||
   latestMain.status!==200||!sameRef(latestMain.body,'main',expectedSha))
   return null;
  return {commitSha,markerPath,markerSha256:digest(text),
   receiptDigest:digest(JSON.stringify([
    REPO_ID,run,markerRun,expectedSha,commitSha,digest(text)
   ])),remoteReadbackVerified:true};
 }
 const baseCommit=await get('/git/commits/'+expectedSha);
 if(baseCommit.status!==200||baseCommit.body?.sha!==expectedSha||
   !SHA.test(baseCommit.body.tree?.sha||''))
  return held('exact-source-commit-tree-unavailable');
 const baseTreeSha=baseCommit.body.tree.sha;

 if(mode==='verify'){
  if(baseSha===expectedSha)return held('marker-commit-not-present');
  const proof=await verifyMarker(baseSha,marker);
  return proof?verified('marker-commit-lineage-and-one-file-readback',proof):
   held('marker-lineage-content-or-main-readback-denied');
 }
 // A marker only advances an existing branch previously verified at exact main.
 if(baseSha!==expectedSha)return held('preexisting-branch-mutation-reconcile-required');
 const priorContent=await get('/contents/'+markerPath+'?ref='+expectedSha);
 if(priorContent.status!==404)
  return held('canary-marker-path-preexists-or-unavailable');
 const markerText=markerDocument({targetRunId:run,markerRunId:marker,
  sourceSha:expectedSha});
 const uncertain=(reason)=>held(reason,{writeAttempted:true,
  writeOutcomeUncertain:true});
 const tree=await send('POST','/git/trees',{
  base_tree:baseTreeSha,
  tree:[{path:markerPath,mode:'100644',type:'blob',content:markerText}]
 });
 if(tree.status!==201||!SHA.test(tree.body?.sha||''))
  return uncertain('marker-tree-write-unverified');
 const commit=await send('POST','/git/commits',{
  message:'test(canary): owner approved marker '+marker,
  tree:tree.body.sha,parents:[expectedSha]
 });
 if(commit.status!==201||!SHA.test(commit.body?.sha||'')||
   commit.body.sha===expectedSha||commit.body.tree?.sha!==tree.body.sha)
  return uncertain('marker-commit-write-unverified');
 // One guarded ref update. Do not re-POST or retry after uncertain responses.
 const prePatch=await get('/git/ref/heads/'+branch);
 if(prePatch.status!==200||!refMatches(prePatch.body,expectedSha))
  return uncertain('canary-branch-moved-before-update');
 const patched=await send('PATCH','/git/refs/heads/'+branch,{
  sha:commit.body.sha,force:false
 });
 if(patched.status!==200||!refMatches(patched.body,commit.body.sha))
  return uncertain('branch-ref-update-unverified');
 const proof=await verifyMarker(commit.body.sha,marker);
 if(!proof)return uncertain('post-write-commit-tree-or-file-readback-unverified');
 return verified('owner-marker-commit-and-github-readback',{
  ...proof,writeAttempted:true,externalWritePerformed:true
 });
}
async function cli(){
 const env=process.env,mode=env.OWNER_MATRIX_MODE||'inspect';
 const result=await runOwnerCanaryMatrix({
  env,mode,targetRunId:env.OWNER_MATRIX_TARGET_RUN_ID||'',
  markerRunId:env.OWNER_MATRIX_MARKER_RUN_ID||'',
  expectedSha:env.OWNER_MATRIX_EXPECTED_SHA||'',
  approvalPhrase:env.OWNER_MATRIX_APPROVAL_PHRASE||''
 });
 await mkdir('artifacts',{recursive:true});
 const run=RUN.test(env.GITHUB_RUN_ID||'')?env.GITHUB_RUN_ID:'held';
 await writeFile(resolve('artifacts/owner-canary-matrix-'+run+'.json'),
  JSON.stringify(result,null,2)+'\n',
  {encoding:'utf8',mode:0o600,flag:'wx'});
 console.log('Owner canary matrix:',result.status,
  'mode:',mode,'reason:',result.reason,
  'remoteReadback:',result.remoteReadbackVerified,
  'appPrincipals:',result.appPrincipalsVerified,
  'postgresReceipt:',result.postgresReceiptVerified);
 if(result.status!=='verified')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{await cli();}catch{
  console.error('Owner canary matrix held: runtime-or-artifact-error');
  process.exitCode=2;
 }
}
