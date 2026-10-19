import { readFile, appendFile } from 'node:fs/promises';
import { parseTask,executeCloudTask,formatReceipt,REPOSITORY,taskDigest,parseReceiptComment,
  MAX_TASK_ATTEMPTS } from './cloud-cycle.mjs';
const sha=/^[0-9a-f]{40}$/;
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
async function currentMain(get){
  const ref=await get('/repos/'+REPOSITORY+'/git/ref/heads/main');
  const value=ref?.object?.sha;
  if(!sha.test(value||''))throw Error('Current main could not be verified');
  return value;
}
async function assertIssueSnapshot(get,task,eventIssue,actor){
  const current=await get('/repos/'+REPOSITORY+'/issues/'+task.issueNumber);
  if(current?.number!==task.issueNumber||current?.state!=='open'||
    current?.user?.login!==actor||current?.title!==eventIssue?.title||
    current?.body!==eventIssue?.body)throw Error('Task issue changed or closed; no mutation occurred');
}
export async function runCloudEntry({event,eventName,actor,repository,
  get=path=>github(path),post=(path,data)=>github(path,{method:'POST',data}),runId='',now,
  executorSha=null,runAttempt=1}={}){
  const task=parseTask(event,eventName,actor,repository);
  if(!sha.test(executorSha||''))throw Error('Executor SHA is required');
  const clock=now??(()=>new Date().toISOString());
  const admittedAt=clock();
  const admittedMainSha=await currentMain(get);
  if(admittedMainSha!==executorSha)throw Error('Executor is not current main; no execution occurred');
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
    await assertIssueSnapshot(get,task,event.issue,actor);
  }
  let outcome=await executeCloudTask(task,{get,runId,now:clock,executorSha,runAttempt,attemptOrdinal});
  if(comments){
    const preReceiptAt=clock();
    const preReceiptMainSha=await currentMain(get);
    if(preReceiptMainSha!==executorSha)throw Error('Executor lost current-main lease; no receipt was posted');
    await assertIssueSnapshot(get,task,event.issue,actor);
    outcome={...outcome,sourceAuthority:{executorSha,admittedMainSha,admittedAt,
      preReceiptMainSha,preReceiptAt}};
    const body=formatReceipt(outcome);
    const posted=await post(comments,{body});
    if(!Number.isSafeInteger(posted?.id)||posted.id<=0)throw Error('Receipt not confirmed');
    const audit=await get('/repos/'+REPOSITORY+'/issues/comments/'+posted.id);
    if(audit?.id!==posted.id||audit?.user?.login!=='github-actions[bot]'||audit.body!==body)
      throw Error('Receipt read-back failed');
  }else outcome={...outcome,sourceAuthority:{executorSha,admittedMainSha,admittedAt}};
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
        '**Admitted main SHA:** '+(r.sourceAuthority?.admittedMainSha||'not recorded')+'\n'+
        '**Pre-receipt main SHA:** '+(r.sourceAuthority?.preReceiptMainSha||'not applicable')+'\n'+
        '**Run attempt:** '+(r.runAttempt||'not recorded')+'\n\n'+
        (r.receipts||[]).map(x=>'- '+x.command+': '+x.status+
          ' — '+x.summary+
          (x.details?.mainSha?' (main '+x.details.mainSha+')':'')).join('\n')+'\n');
    console.log(JSON.stringify({status:r.status,issueNumber:r.issueNumber??null}));
    if(!['succeeded','already-processed'].includes(r.status))process.exitCode=1;
  }catch(error){console.error('Ultron cloud job failed: '+error.message);process.exitCode=1;}
}
