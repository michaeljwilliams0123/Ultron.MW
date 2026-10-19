const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
const CONCLUSIONS=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped']);
/**
 * Independently reads only completed Verify jobs on the exact current main
 * source. The input list is treated as untrusted until checked against GitHub
 * workflow identity, source SHA, repository, branch, and terminal conclusion.
 */
export function selectVerifiedMainCi(body,mainSha){
  if(!SHA.test(mainSha||'')||!Array.isArray(body?.workflow_runs)||
     !Number.isSafeInteger(body?.total_count)||body.total_count>100)
    return null;
  const matches=body.workflow_runs.filter(x=>
    x?.name==='Ultron core verification'&&
    x?.path==='.github/workflows/verify.yml'&&
    x?.head_sha===mainSha&&x?.head_branch==='main'&&
    x?.head_repository?.full_name===REPO&&
    ['push','workflow_dispatch'].includes(x?.event)&&
    x?.status==='completed'&&CONCLUSIONS.has(x?.conclusion)&&
    Number.isSafeInteger(x?.id)&&x.id>0&&
    Number.isSafeInteger(x?.run_attempt)&&x.run_attempt>0);
  matches.sort((a,b)=>b.id-a.id);
  const run=matches[0];
  return run?Object.freeze({
    schema:'ultron.ci-main.v1',sha:mainSha,
    runId:run.id,runAttempt:run.run_attempt,conclusion:run.conclusion,
    runUrl:'https://github.com/'+REPO+'/actions/runs/'+run.id,
    evidenceType:'authenticated-github-actions-run',
  }):null;
}
export async function readVerifiedMainCi({get,mainSha}={}){
  if(typeof get!=='function'||!SHA.test(mainSha||''))return null;
  try{
    const body=await get(ROOT+'/actions/runs?head_sha='+mainSha+'&per_page=100');
    return selectVerifiedMainCi(body,mainSha);
  }catch{return null;} // Unknown is not a failed check or a passing check.
}
