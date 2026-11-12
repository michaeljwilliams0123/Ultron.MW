/**
 * Convert independently read GitHub PR, comparison and check-run responses to
 * advisory exact-head verification. This is not model acceptance, owner signing,
 * branch protection, or authority for a write or release.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const ACTIONS_APP_ID=15368;
const REQUIRED=Object.freeze(['test','fixed-comparison','attested-receipt']);
const SHA=/^[a-f0-9]{40}$/;

function denied(reason){
 return Object.freeze({schema:'ultron.council-exact-head-evidence.v1',
   verified:false,reason,sourceSha:null,prNumber:null,
   repositoryId:REPO_ID,providerAppId:ACTIONS_APP_ID,
   checks:Object.freeze([]),baseUpToDate:false,releaseAuthorized:false});
}
function canonical(repo){return repo?.id===REPO_ID&&repo?.full_name===REPO;}
export function buildCouncilExactHeadEvidence({pr,comparison,checkRuns}={}){
 if(!pr||pr.state!=='open'||!Number.isSafeInteger(pr.number)||pr.number<1||
   !SHA.test(pr.head?.sha||'')||!SHA.test(pr.base?.sha||'')||
   pr.base?.ref!=='main'||!canonical(pr.head.repo)||!canonical(pr.base.repo))
  return denied('pr-provenance-unverified');
 if(!comparison||
   !['ahead','identical'].includes(comparison.status)||
   comparison.behind_by!==0||
   comparison.merge_base_commit?.sha!==pr.base.sha)
  return denied('source-behind-or-base-drift');
 if(!Array.isArray(checkRuns?.check_runs)||
   checkRuns.check_runs.length===0||checkRuns.check_runs.length>250)
  return denied('check-run-inventory-unavailable');
 for(const name of REQUIRED){
  const matches=checkRuns.check_runs.filter(x=>x?.name===name);
  // GitHub retains earlier attempts on a stable commit, including old failed
  // checks. Pick the highest provider-generated check-run ID, not array order.
  // Any conflicting App identity or duplicate ID remains an ambiguity: HOLD.
  if(matches.length<1||matches.length>100||
     matches.some(r=>!Number.isSafeInteger(r?.id)||r.id<1||
       r.head_sha!==pr.head.sha||r.app?.id!==ACTIONS_APP_ID||
       r.app?.slug!=='github-actions')||
     new Set(matches.map(r=>r.id)).size!==matches.length)
   return denied('required-check-missing-or-ambiguous');
  const observed=matches.reduce((newest,item)=>item.id>newest.id?item:newest);
  if(observed.status!=='completed'||observed.conclusion!=='success')
   return denied('required-check-not-verified');
 }
 return Object.freeze({
  schema:'ultron.council-exact-head-evidence.v1',
  verified:true,reason:null,sourceSha:pr.head.sha,prNumber:pr.number,
  repositoryId:REPO_ID,providerAppId:ACTIONS_APP_ID,
  checks:Object.freeze([...REQUIRED]),baseUpToDate:true,
  releaseAuthorized:false
 });
}
