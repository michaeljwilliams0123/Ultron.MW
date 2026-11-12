const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
const VERIFY_PATH='.github/workflows/verify.yml';
const CONCLUSIONS=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped']);
/**
 * Independently reads only completed Verify runs on the exact current main
 * source. The input list is treated as untrusted until checked against GitHub
 * workflow identity, source SHA, repository, branch, and terminal conclusion.
 * Identity is the workflow file path, never the run name: verify.yml's
 * `run-name:` makes the API report the PR title or head commit message as
 * `name`, so a name match would never find main CI (see ci-job-presence.mjs).
 */
export function selectVerifiedMainCi(body,mainSha){
  if(!SHA.test(mainSha||'')||!Array.isArray(body?.workflow_runs)||
     !Number.isSafeInteger(body?.total_count)||body.total_count<0||
     body.total_count!==body.workflow_runs.length||body.total_count>=100)
    return null;
  const matches=body.workflow_runs.filter(x=>
    x?.path===VERIFY_PATH&&
    x?.head_sha===mainSha&&x?.head_branch==='main'&&
    x?.head_repository?.full_name===REPO&&
    ['push','workflow_dispatch'].includes(x?.event)&&
    Number.isSafeInteger(x?.id)&&x.id>0&&
    Number.isSafeInteger(x?.run_attempt)&&x.run_attempt>0);
  matches.sort((a,b)=>b.id-a.id);
  const run=matches[0];
  return run&&run.status==='completed'&&CONCLUSIONS.has(run.conclusion)?Object.freeze({
    schema:'ultron.ci-main.v1',sha:mainSha,
    runId:run.id,runAttempt:run.run_attempt,conclusion:run.conclusion,
    event:run.event,
    runUrl:'https://github.com/'+REPO+'/actions/runs/'+run.id,
    evidenceType:'authenticated-github-actions-run',
  }):null;
}
export async function readVerifiedMainCi({get,mainSha}={}){
  if(typeof get!=='function'||!SHA.test(mainSha||''))return null;
  try{
    // Scope to verify.yml on main: the repo-wide runs list for one SHA mixes
    // every workflow and routinely exceeds one page, which fails closed.
    const body=await get(ROOT+'/actions/workflows/verify.yml/runs?head_sha='+
      mainSha+'&branch=main&per_page=100');
    return selectVerifiedMainCi(body,mainSha);
  }catch{return null;} // Unknown is not a failed check or a passing check.
}

/** Isomorphic, strictly typed-by-observation GitHub Verify evidence.
 * Source identity is workflow path AND workflow ID; run.name is display-only.
 * This module has no Node or Hatchable dependencies and can be mirrored byte-for-byte.
 */
export const CORE_VERIFY_WORKFLOW=Object.freeze({
 path:'.github/workflows/verify.yml',workflowId:388875616,
 requiredJobs:Object.freeze({push:['test','attested-receipt'],
  workflow_dispatch:['test'],pull_request:['test','fixed-comparison']})
});
export function evaluateWorkflowEvidence({runs,jobsByRunId={},targetSha,allowedEvents=['push','workflow_dispatch']}={}){
 const result=(status,run=null)=>Object.freeze({schema:'ultron.verified-ci-evidence.v1',
  status,verified:status==='verified',runId:run?.id??null,
  workflowId:run?.workflow_id??null,headSha:targetSha??null,
  conclusion:status==='verified'?'success':null});
 if(!SHA.test(targetSha||''))return result('invalid-sha');
 if(!Array.isArray(runs))return result('unavailable');
 const matches=runs.filter(r=>r?.path===CORE_VERIFY_WORKFLOW.path&&
  r?.workflow_id===CORE_VERIFY_WORKFLOW.workflowId&&
  r?.head_sha===targetSha&&r?.head_branch==='main'&&
  r?.head_repository?.full_name===REPO&&allowedEvents.includes(r?.event)&&
  Number.isSafeInteger(r?.id)&&r.id>0&&
  Number.isSafeInteger(r?.run_attempt)&&r.run_attempt>0)
  .sort((a,b)=>b.id-a.id);
 if(!matches.length)return result('pending-or-absent');
 const run=matches[0];
 if(run.status!=='completed')return result('in-progress',run);
 const response=jobsByRunId[run.id];
 if(!response||!Array.isArray(response.jobs)||
  !Number.isSafeInteger(response.total_count)||
  response.total_count!==response.jobs.length||
  response.total_count>=100)return result('unknown-missing',run);
 const expected=CORE_VERIFY_WORKFLOW.requiredJobs[run.event];
 if(!expected)return result('unavailable',run);
 const jobs=response.jobs.filter(j=>j.run_attempt===run.run_attempt);
 if(new Set(jobs.map(j=>j.name)).size!==jobs.length)return result('unknown-missing',run);
 if(expected.some(name=>!jobs.some(j=>j.name===name)))return result('unknown-missing',run);
 if(expected.some(name=>jobs.find(j=>j.name===name)?.conclusion==='skipped'))
  return result('unknown-missing',run);
 if(expected.some(name=>jobs.find(j=>j.name===name)?.status!=='completed'))
  return result('in-progress',run);
 if(expected.some(name=>jobs.find(j=>j.name===name)?.conclusion!=='success')||
  run.conclusion!=='success')return result('failed',run);
 return result('verified',run);
}
