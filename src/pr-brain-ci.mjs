import {readFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {githubRequest} from './cloud-pr.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
export const CI_MARKER='<!-- ULTRON_CI_OBSERVATION_V1';
const WORKFLOW_NAME='Ultron core verification';
const VERIFY_PATH='.github/workflows/verify.yml';
const TERMINAL=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped']);
function checkRun(r){
  if(r?.name!==WORKFLOW_NAME||r?.status!=='completed'||
      !TERMINAL.has(r?.conclusion)||!Number.isSafeInteger(r?.id)||
      !SHA.test(r?.head_sha||'')||!['pull_request','workflow_dispatch'].includes(r?.event)||
      r?.head_repository?.full_name!==REPO||!r?.path?.includes(VERIFY_PATH)||
      !Number.isSafeInteger(r?.run_attempt)||r.run_attempt<1)
    throw Error('Cannot verify a trusted terminal Ultron Verify run');
}
export function verifiedCiReceipt({run,pr,status}){
  checkRun(run);
  const marker=CI_MARKER+' run:'+run.id+':'+run.run_attempt+' -->';
  const result=status==='current'?run.conclusion:'stale';
  return [
    marker,
    '### Ultron · observed verification',
    '',
    '- PR: #'+pr.number,
    '- Source SHA: '+run.head_sha,
    '- PR head at observation: '+pr.head.sha,
    '- Workflow: '+WORKFLOW_NAME,
    '- Result: **'+result+'**',
    '- Evidence: https://github.com/'+REPO+'/actions/runs/'+run.id,
    '- Run attempt: '+run.run_attempt,
    '',
    status==='current'?
      'The workflow conclusion above was read back from GitHub for this exact current PR head. It does not establish production-runtime readiness.':
      'The PR advanced since this run began. Its conclusion is historical only; rerun Verify at the current head.',
  ].join('\n');
}
export async function reportCiToPr({event,repository,get,post}={}){
  if(repository!==REPO||typeof get!=='function'||typeof post!=='function'||
      event?.action!=='completed'||!Number.isSafeInteger(event?.workflow_run?.id))
    throw Error('Unsupported verify observation event');
  const run=await get(ROOT+'/actions/runs/'+event.workflow_run.id);
  checkRun(run);
  if(event.workflow_run.head_sha!==run.head_sha||
      event.workflow_run.conclusion!==run.conclusion)
    throw Error('Verify webhook and authenticated GitHub source disagree');

  const prs=await get(ROOT+'/pulls?state=open&per_page=100');
  if(!Array.isArray(prs)||prs.length>=100)throw Error('Incomplete open PR inventory');
  const candidates=prs.filter(p=>p.state==='open'&&p.base?.ref==='main'&&
    p.head?.repo?.full_name===REPO&&p.head?.ref?.startsWith('ultron/')&&
    p.head?.ref===run.head_branch);
  if(candidates.length>1)throw Error('Ambiguous PR verification target');
  const candidate=candidates[0];
  if(!candidate)return {status:'no-open-ultron-pr',created:false,runId:run.id};
  const pr=await get(ROOT+'/pulls/'+candidate.number);
  if(pr.number!==candidate.number||pr.state!=='open'||pr.head.ref!==run.head_branch||
      pr.base?.ref!=='main'||pr.head?.repo?.full_name!==REPO||!SHA.test(pr.head?.sha||''))
    throw Error('Verify target changed or cannot be authenticated');
  const status=pr.head.sha===run.head_sha?'current':'stale';
  const body=verifiedCiReceipt({run,pr,status});
  const marker=body.split('\n')[0];
  for(let page=1;page<=5;page++){
    const comments=await get(ROOT+'/issues/'+pr.number+'/comments?per_page=100&page='+page);
    if(!Array.isArray(comments))throw Error('Cannot verify existing CI receipts');
    const previous=comments.find(c=>c.user?.login==='github-actions[bot]'&&c.body?.startsWith(marker));
    if(previous)return {status:'already-reported',created:false,prNumber:pr.number,runId:run.id};
    if(comments.length<100)break;
    if(page===5)throw Error('CI receipt comment history exceeded audit limit');
  }
  // No production token or build artifact is transferred from the completed runner.
  const comment=await post(ROOT+'/issues/'+pr.number+'/comments',{body});
  if(!Number.isSafeInteger(comment?.id)||comment.id<1)throw Error('GitHub did not accept CI receipt');
  const readback=await get(ROOT+'/issues/comments/'+comment.id);
  if(readback?.id!==comment.id||readback.body!==body||
      readback.user?.login!=='github-actions[bot]')
    throw Error('CI receipt failed authenticated readback');
  return {status:'reported',created:true,prNumber:pr.number,runId:run.id,
    result:status==='current'?run.conclusion:'stale',sha:run.head_sha,commentId:comment.id};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
    const result=await reportCiToPr({event,repository:process.env.GITHUB_REPOSITORY,
      get:p=>githubRequest(p),post:(p,body)=>githubRequest(p,{method:'POST',body})});
    if(process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY,'### Ultron verified CI\n\n'+JSON.stringify(result)+'\n');
    console.log(JSON.stringify(result));
  }catch(error){console.error('Ultron CI feedback failed: '+error.message);process.exitCode=1;}
}
