// Historical GitHub evidence only. Neither an installation credential nor a write grant.
const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const PROOF_SHA='ab1fedf1595956221cd92c7c1c6b3980c147b728';
const BOT='ultron-coordinator[bot]';
const RUN_ID=42888428130;
const COMMENT_ID=6777504499;
const SHA=/^[a-f0-9]{40}$/;
const ACTOR={login:'michaeljwilliams0123',id:308995719,type:'User'};
const BOT_ACTOR={login:BOT,id:353078104,type:'Bot'};
function sameActor(actual,expected){
 return actual?.login===expected.login&&actual?.id===expected.id&&
  actual?.type===expected.type;
}
function baseline(state,details={}){
 return {
  schema:'ultron.coordinator-historical-proof.v1',
  state,readOnly:true,repository:REPO,
  botIdentityVerified:false,workflowVerified:false,
  githubAppProvenanceVerified:false,mainLineageVerified:false,
  historicalGithubCommentObserved:false,
  installationVerified:false,ownerSignedGrantVerified:false,
  externalMutationAuthorized:false,durableWriteReceiptVerified:false,
  productionAccepted:false,paidExternalSpendUSD:0,
  ...details
 };
}
export async function verifyHistoricalCoordinatorProof(call){
 if(typeof call!=='function')return baseline('provider-readback-unavailable');
 const get=async path=>{
  const response=await call('github_operator',{method:'GET',path});
  if(response?.status!==200||!response?.body||typeof response.body!=='object')
   throw Error('github-readback-unavailable');
  return response.body;
 };
 try{
  const [comment,run,ref]=await Promise.all([
   get(ROOT+'/issues/comments/'+COMMENT_ID),
   get(ROOT+'/actions/runs/'+RUN_ID),
   get(ROOT+'/git/ref/heads/main')
  ]);
  const botIdentityVerified=comment.id===COMMENT_ID&&
   comment.issue_url==='https://api.github.com'+ROOT+'/issues/186'&&
   sameActor(comment.user,BOT_ACTOR)&&
   typeof comment.body==='string'&&
   comment.body.includes('Run: https://github.com/'+REPO+'/actions/runs/'+RUN_ID)&&
   comment.body.includes('Source: '+String.fromCharCode(96)+PROOF_SHA+String.fromCharCode(96))&&
   comment.body.includes('identity proof (council-identity-proof:builder:a75b152fa573d364)')&&
   comment.body.includes('<!-- council-identity-proof:builder:a75b152fa573d364 -->');
  const workflowVerified=run.id===RUN_ID&&
   run.head_sha===PROOF_SHA&&run.event==='workflow_dispatch'&&
   run.status==='completed'&&run.conclusion==='success'&&
   sameActor(run.actor,ACTOR)&&sameActor(run.triggering_actor,ACTOR)&&
   run.repository?.id===1424939667&&run.repository?.full_name===REPO&&
   run.head_repository?.id===1424939667&&run.head_repository?.full_name===REPO;
  const mainSha=ref.ref==='refs/heads/main'&&ref.object?.type==='commit'&&
   SHA.test(ref.object?.sha||'')?ref.object.sha:null;
  if(!botIdentityVerified||!workflowVerified||!mainSha)
   return baseline('historical-proof-unverified');
  const compare=await get(ROOT+'/compare/'+PROOF_SHA+'...'+mainSha);
  const mainLineageVerified=compare.behind_by===0&&
   compare.merge_base_commit?.sha===PROOF_SHA&&
   (compare.status==='ahead'&&compare.ahead_by>0&&
     compare.commits?.at(-1)?.sha===mainSha||
    compare.status==='identical'&&compare.ahead_by===0&&mainSha===PROOF_SHA);
  if(!mainLineageVerified)return baseline('historical-proof-unverified');
  const githubAppProvenanceVerified=comment.performed_via_github_app?.id===5633654&&
   comment.performed_via_github_app?.slug==='ultron-coordinator';
  const attributionUnexpected=comment.performed_via_github_app!=null&&
    !githubAppProvenanceVerified;
  if(attributionUnexpected)return baseline('historical-proof-unverified');
  return baseline(githubAppProvenanceVerified?'historical-proof-verified':
   'historical-proof-partial',{
    botIdentityVerified:true,workflowVerified:true,mainLineageVerified:true,
    githubAppProvenanceVerified,
    historicalGithubCommentObserved:true,sourceSha:PROOF_SHA,mainSha,
    proofCommentUrl:'https://github.com/'+REPO+'/issues/186#issuecomment-'+COMMENT_ID,
    workflowRunUrl:'https://github.com/'+REPO+'/actions/runs/'+RUN_ID,
    note:githubAppProvenanceVerified?
     'Historical app-attributed comment verified; no live execution authorization.':
     'GitHub OAuth did not expose App attribution; bot identity and run verified only.'
   });
 }catch{
  return baseline('provider-readback-unavailable');
 }
}
