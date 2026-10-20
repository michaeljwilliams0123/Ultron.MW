import { verifyPolicy, velocityEnabled } from './velocity.mjs';
const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
const RESULTS=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped']);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function observedRun(r,ref,sha,lower=0){
  return r?.id>lower&&r?.name==='Ultron core verification'&&
    r?.path==='.github/workflows/verify.yml'&&r?.event==='workflow_dispatch'&&
    r?.head_branch===ref&&r?.head_sha===sha&&
    typeof r?.status==='string'&&RESULTS.has(r?.conclusion||'neutral');
}
export async function waitForExactHeadVerify({get,ref,sha,timeoutMs=120000,pollMs=4000}={}){
  if(typeof get!=='function'||typeof ref!=='string'||!SHA.test(sha||''))
    throw Error('Exact-head verify requires get, ref, and sha');
  const policy=verifyPolicy();
  const started=Date.now();
  let lower=0;
  while(Date.now()-started<timeoutMs){
    const runs=await get(ROOT+'/actions/workflows/verify.yml/runs?branch='+encodeURIComponent(ref)+'&per_page=10');
    const list=Array.isArray(runs?.workflow_runs)?runs.workflow_runs:[];
    const hit=list.find(r=>observedRun(r,ref,sha,lower));
    if(hit){
      if(hit.conclusion==='success')return Object.freeze({ok:true,runId:hit.id,sha,ref,policy:policy.mode});
      if(policy.mode==='advisory'){
        console.warn('velocity advisory: verify conclusion='+hit.conclusion);
        return Object.freeze({ok:true,advisory:true,runId:hit.id,sha,ref,conclusion:hit.conclusion,policy:'advisory'});
      }
      return Object.freeze({ok:false,runId:hit.id,sha,ref,conclusion:hit.conclusion,policy:policy.mode});
    }
    await wait(pollMs);
  }
  if(policy.mode==='advisory'){
    console.warn('velocity advisory: verify timeout');
    return Object.freeze({ok:true,advisory:true,timeout:true,sha,ref,policy:'advisory'});
  }
  throw Error('Exact-head verify timed out for '+ref+'@'+sha.slice(0,7));
}
export function verificationBlocking(env = process.env) {
  return verifyPolicy(env).mode === 'blocking';
}
