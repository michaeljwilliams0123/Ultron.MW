/**
 * Bind a GitHub Council workflow run to the currently open PR.
 * GitHub REST may legitimately return pull_requests: [] even when the run
 * was triggered by that PR (observed run #42946913773). The remaining fields
 * must all independently agree; do not trust PR body, model text or run labels.
 *
 * This is source provenance only, not a seven-role approval.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const WORKFLOW_ID=401204437;
const WORKFLOW_PATH='.github/workflows/council-debate.yml';
const SHA=/^[a-f0-9]{40}$/;

const canonical=repo=>repo?.id===REPO_ID&&repo?.full_name===REPO;

export function matchCouncilReviewRun(run,pr){
 if(!pr||!run||
   !Number.isSafeInteger(pr.number)||pr.number<1||
   pr.state!=='open'||
   !SHA.test(pr.head?.sha||'')||
   !SHA.test(pr.base?.sha||'')||
   typeof pr.head?.ref!=='string'||!pr.head.ref||
   !canonical(pr.head.repo)||!canonical(pr.base.repo)||
   pr.base.ref!=='main')return false;
 if(!Number.isSafeInteger(run.id)||run.id<1||
   run.event!=='pull_request'||run.status!=='completed'||
   run.conclusion!=='success'||
   run.workflow_id!==WORKFLOW_ID||run.path!==WORKFLOW_PATH||
   run.head_sha!==pr.head.sha||
   run.head_branch!==pr.head.ref||
   !canonical(run.head_repository)||!canonical(run.repository)||
   !Array.isArray(run.pull_requests))return false;
 // Empty PR associations are valid for actual GitHub runs; if GitHub supplied
 // an association it must agree, rather than allowing contradictory metadata.
 if(run.pull_requests.length>0&&!run.pull_requests.some(p=>p?.number===pr.number))
  return false;
 return true;
}
export function selectLatestCouncilReviewRun(runs,pr){
 if(!Array.isArray(runs))return null;
 return runs.filter(r=>matchCouncilReviewRun(r,pr))
  .sort((a,b)=>b.id-a.id)[0]??null;
}
