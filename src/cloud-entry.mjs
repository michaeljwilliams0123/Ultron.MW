import { readFile, appendFile } from 'node:fs/promises';
import { parseTask,executeCloudTask,formatReceipt,REPOSITORY,MARKER } from './cloud-cycle.mjs';
async function github(path,{method='GET',data}={}){
  if(!process.env.GITHUB_TOKEN||!path.startsWith('/repos/'+REPOSITORY+'/'))
    throw Error('Unapproved GitHub API request');
  const res=await fetch('https://api.github.com'+path,{
    method,headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,
      Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
      ...(data?{'Content-Type':'application/json'}:{})},
    ...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error('GitHub API returned '+res.status);
  return res.json();
}
export async function runCloudEntry({event,eventName,actor,repository,
  get=path=>github(path),post=(path,data)=>github(path,{method:'POST',data}),runId='',now}={}){
  const task=parseTask(event,eventName,actor,repository);
  const comments=task.issueNumber===null?null:'/repos/'+REPOSITORY+'/issues/'+task.issueNumber+'/comments';
  if(comments){
    const existing=await get(comments+'?per_page=100');
    if(!Array.isArray(existing))throw Error('Cannot audit issue comments');
    if(existing.some(x=>x?.user?.login==='github-actions[bot]'&&x.body?.includes(MARKER)))
      return {status:'already-processed',issueNumber:task.issueNumber};
  }
  const outcome=await executeCloudTask(task,{get,runId,now});
  if(comments){
    const posted=await post(comments,{body:formatReceipt(outcome)});
    if(!Number.isSafeInteger(posted?.id))throw Error('Receipt not confirmed');
    const audit=await get(comments+'?per_page=100');
    if(!Array.isArray(audit)||!audit.some(x=>x.id===posted.id&&x.body?.includes(outcome.objectiveDigest)))
      throw Error('Receipt read-back failed');
  }
  return outcome;
}
if(import.meta.url==='file://'+process.argv[1]){
  try{
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
    const r=await runCloudEntry({event,eventName:process.env.GITHUB_EVENT_NAME,
      actor:process.env.GITHUB_ACTOR,repository:process.env.GITHUB_REPOSITORY,
      runId:process.env.GITHUB_RUN_ID});
    if(process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        '## Ultron cloud observation\n**Status:** '+r.status+
        '\n**Backend:** GitHub Actions (no owner PC)\n\n'+
        (r.receipts||[]).map(x=>'- '+x.command+': '+x.status+
          ' — '+x.summary+
          (x.details?.mainSha?' (main '+x.details.mainSha+')':'')).join('\n')+'\n');
    console.log(JSON.stringify({status:r.status,issueNumber:r.issueNumber??null}));
  }catch(error){console.error('Ultron cloud job failed: '+error.message);process.exitCode=1;}
}
