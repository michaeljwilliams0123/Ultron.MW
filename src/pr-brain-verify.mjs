const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
const RESULTS=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped']);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function observedRun(r,ref,sha,lower=0){
  return r?.id>lower&&r?.name==='Ultron core verification'&&
    r?.path==='.github/workflows/verify.yml'&&r?.event==='workflow_dispatch'&&
    r?.head_branch===ref&&r?.head_sha===sha&&r?.head_repository?.full_name===REPO;
}
async function findRuns(get,ref){
  const path=ROOT+'/actions/runs?branch='+encodeURIComponent(ref)+'&per_page=30';
  const data=await get(path);
  if(!Array.isArray(data?.workflow_runs)||
     !Number.isSafeInteger(data?.total_count))
    throw Error('GitHub Verify run inventory unavailable');
  return data.workflow_runs;
}
/**
 * Close the loop inside the ORIGINAL PR comment job. This does not rely on a
 * workflow_run webhook, which GitHub may suppress in a GITHUB_TOKEN chain.
 * Returns only an authenticated exact-head run (or explicitly pending).
 */
export async function dispatchAndObserveVerify({
  get,post,branch,headSha,maxPolls=14,intervalMs=4000,sleep=wait,
}={}){
  if(typeof get!=='function'||typeof post!=='function'||
     typeof sleep!=='function'||!branch?.startsWith('ultron/')||
     !SHA.test(headSha||'')||!Number.isSafeInteger(maxPolls)||
     maxPolls<1||maxPolls>20||intervalMs<0||intervalMs>10000)
    throw Error('Invalid bounded CI observation request');
  const before=await findRuns(get,branch);
  const baseline=Math.max(0,...before.map(x=>x.id).filter(Number.isSafeInteger));
  const posted=await post(ROOT+'/actions/workflows/verify.yml/dispatches',{ref:branch});
  if(posted&&typeof posted==='object'&&Object.keys(posted).length)
    throw Error('Unexpected Verify dispatch response');
  for(let poll=0;poll<maxPolls;poll++){
    if(poll>0)await sleep(intervalMs);
    const current=await findRuns(get,branch);
    const match=current.filter(x=>observedRun(x,branch,headSha,baseline))
      .sort((a,b)=>b.id-a.id)[0];
    if(!match)continue;
    if(match.status==='completed'&&RESULTS.has(match.conclusion)){
      const verified=await get(ROOT+'/actions/runs/'+match.id);
      if(!observedRun(verified,branch,headSha,baseline)||
        verified.status!=='completed'||verified.conclusion!==match.conclusion||
        verified.run_attempt!==match.run_attempt)
        throw Error('Verify run result failed authenticated readback');
      return {state:'completed',conclusion:verified.conclusion,runId:verified.id,
        sha:verified.head_sha,runAttempt:verified.run_attempt,
        url:'https://github.com/'+REPO+'/actions/runs/'+verified.id};
    }
  }
  return {state:'pending',conclusion:null,sha:headSha,
    reason:'No terminal GitHub Verify result observed within bounded attempt window'};
}
