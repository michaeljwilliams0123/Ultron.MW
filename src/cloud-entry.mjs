import { readFile, appendFile } from 'node:fs/promises';
import { parseTask,executeCloudTask,formatReceipt,REPOSITORY,taskDigest,parseReceiptComment,
  MAX_TASK_ATTEMPTS } from './cloud-cycle.mjs';
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
  get=path=>github(path),post=(path,data)=>github(path,{method:'POST',data}),runId='',now,
  executorSha=null,runAttempt=1}={}){
  const task=parseTask(event,eventName,actor,repository);
  const comments=task.issueNumber===null?null:'/repos/'+REPOSITORY+'/issues/'+task.issueNumber+'/comments';
  let attemptOrdinal=1;
  if(comments){
    let complete=false,commentOffset=0;
    const attempts=new Map();
    for(let page=1;page<=10;page++){
      const existing=await get(comments+'?per_page=100&page='+page);
      if(!Array.isArray(existing))throw Error('Cannot audit issue comments');
      for(const [index,comment] of existing.entries()){
        const receipt=parseReceiptComment(comment);
        if(receipt?.objectiveDigest!==taskDigest(task)||receipt.issueNumber!==task.issueNumber)continue;
        if(receipt.status==='succeeded')return {status:'already-processed',issueNumber:task.issueNumber,
          previousRunId:receipt.runId};
        const key=receipt.runId&&Number.isSafeInteger(receipt.runAttempt)?
          receipt.runId+':'+receipt.runAttempt:'comment:'+(comment.id??commentOffset+index);
        attempts.set(key,receipt);
      }
      commentOffset+=existing.length;
      if(existing.length<100){complete=true;break;}
    }
    if(!complete)throw Error('Comment audit limit reached; no execution occurred');
    const prior=[...attempts.values()];
    if(prior.some(receipt=>receipt.status==='blocked'))return {status:'blocked',
      issueNumber:task.issueNumber,replay:true,retry:{disposition:'terminal',
        attemptsUsed:prior.length,attemptLimit:MAX_TASK_ATTEMPTS}};
    if(prior.length>=MAX_TASK_ATTEMPTS)return {status:'retry-exhausted',
      issueNumber:task.issueNumber,retry:{disposition:'exhausted',
        attemptsUsed:prior.length,attemptLimit:MAX_TASK_ATTEMPTS}};
    attemptOrdinal=prior.length+1;
  }
  const outcome=await executeCloudTask(task,{get,runId,now,executorSha,runAttempt,attemptOrdinal});
  if(comments){
    const body=formatReceipt(outcome);
    const posted=await post(comments,{body});
    if(!Number.isSafeInteger(posted?.id)||posted.id<=0)throw Error('Receipt not confirmed');
    const audit=await get('/repos/'+REPOSITORY+'/issues/comments/'+posted.id);
    if(audit?.id!==posted.id||audit?.user?.login!=='github-actions[bot]'||audit.body!==body)
      throw Error('Receipt read-back failed');
  }
  return outcome;
}
if(import.meta.url==='file://'+process.argv[1]){
  try{
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
    const r=await runCloudEntry({event,eventName:process.env.GITHUB_EVENT_NAME,
      actor:process.env.GITHUB_ACTOR,repository:process.env.GITHUB_REPOSITORY,
      runId:process.env.GITHUB_RUN_ID,executorSha:process.env.GITHUB_SHA??null,
      runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT??1)});
    if(process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        '## Ultron cloud observation\n**Status:** '+r.status+
        '\n**Backend:** GitHub Actions (no owner PC)\n'+
        '**Executor SHA:** '+(r.executorSha||'not recorded')+'\n'+
        '**Run attempt:** '+(r.runAttempt||'not recorded')+'\n\n'+
        (r.receipts||[]).map(x=>'- '+x.command+': '+x.status+
          ' — '+x.summary+
          (x.details?.mainSha?' (main '+x.details.mainSha+')':'')).join('\n')+'\n');
    console.log(JSON.stringify({status:r.status,issueNumber:r.issueNumber??null}));
    if(!['succeeded','already-processed'].includes(r.status))process.exitCode=1;
  }catch(error){console.error('Ultron cloud job failed: '+error.message);process.exitCode=1;}
}
