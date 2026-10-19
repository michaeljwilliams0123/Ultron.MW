import { createHash } from 'node:crypto';
import { planObjective } from '../docs/core/cycle.mjs';
import { commandsFor, capabilityManifest } from '../docs/core/capabilities.mjs';
import { deliberatePlan } from './grokbot-governor.mjs';
export const REPOSITORY='michaeljwilliams0123/Ultron.MW';
export const MARKER='<!-- ULTRON_CLOUD_RECEIPT_V1 -->';
export const RECEIPT_SCHEMA='ultron.cloud.receipt.v2';
export const MAX_TASK_ATTEMPTS=3;
const allowed=new Set(commandsFor('cloud'));
const sha=/^[0-9a-f]{40}$/;
export function taskDigest(task){
  return createHash('sha256').update(JSON.stringify([task.repository,task.issueNumber,task.objective])).digest('hex');
}
export function parseTask(event,name,actor,repository){
  // Cron has no user-controlled task text; repository-scoped default-branch
  // workflow is the authority. User-submitted tasks still require owner identity.
  if(repository!==REPOSITORY||(name!=='schedule'&&actor!=='michaeljwilliams0123'))
    throw Error('Untrusted owner or repository');
  let objective,issueNumber=null;
  if(name==='issues'){
    const issue=event?.issue;
    if(event?.action!=='opened'||issue?.user?.login!==actor||
       issue?.title!=='[Ultron Cloud] Objective'||!Number.isSafeInteger(issue?.number)||
       issue.number<=0||!issue.body?.startsWith('ULTRON_CLOUD_V1\n'))
      throw Error('Untrusted issue or missing task marker');
    objective=issue.body.slice('ULTRON_CLOUD_V1\n'.length).trim();
    issueNumber=issue.number;
  }else if(name==='workflow_dispatch'){
    if(event?.sender?.login&&event.sender.login!==actor)throw Error('Untrusted dispatch');
    objective=event?.inputs?.objective;
  }else if(name==='schedule'){
    // Deterministic owner-repository health observation, never arbitrary input.
    objective='/repo inspect';
  }else throw Error('Unsupported event');
  if(typeof objective!=='string'||!objective.trim()||objective.length>1000||
    /[\r\n\u0000-\u001f]/.test(objective))throw Error('Invalid single-line objective');
  return {objective:objective.trim(),issueNumber,repository};
}
export async function executeCloudTask(task,{get,now=()=>new Date().toISOString(),runId='',
  executorSha=null,runAttempt=1,attemptOrdinal=1}={}){
  if(task?.repository!==REPOSITORY||typeof get!=='function')throw Error('Invalid cloud context');
  if((executorSha!==null&&!sha.test(executorSha))||!Number.isSafeInteger(runAttempt)||runAttempt<1||
    !Number.isSafeInteger(attemptOrdinal)||attemptOrdinal<1||attemptOrdinal>MAX_TASK_ATTEMPTS)
    throw Error('Invalid executor provenance');
  const plan=planObjective(task.objective,{strategy:'routing-v2'});
  const startedAt=now();
  const readySteps=plan.steps.filter(step=>step.status==='ready'&&allowed.has(step.command)).length;
  const blockedSteps=plan.steps.length-readySteps;
  const evidenceCoverage=readySteps/plan.steps.length;
  const cognition=deliberatePlan(plan,{
    evidenceCoverage,calibratedConfidence:evidenceCoverage,
    knownUnknowns:plan.steps.filter(step=>step.status!=='ready'||!allowed.has(step.command))
      .map(step=>'unsupported-step:'+step.index),
    materialConflictCount:blockedSteps,
    observedAt:new Date(startedAt).toISOString(),
  });
  const base={schema:RECEIPT_SCHEMA,source:'GitHub Actions',
    issueNumber:task.issueNumber,checkedAt:startedAt,startedAt,runId:String(runId).slice(0,32),
    executorSha,runAttempt,runUrl:/^[0-9]{1,32}$/.test(String(runId))?
      'https://github.com/'+REPOSITORY+'/actions/runs/'+runId:null,
    attemptOrdinal,attemptLimit:MAX_TASK_ATTEMPTS,
    objectiveDigest:taskDigest(task),cognition,
    localMachineRequired:false,autonomousWriteAccess:false};
  const finish=(status,receipts)=>({...base,status,finishedAt:now(),receipts,
    retry:{disposition:status==='succeeded'||status==='blocked'?'terminal':
      attemptOrdinal<MAX_TASK_ATTEMPTS?'eligible':'exhausted',
    attemptsUsed:attemptOrdinal,attemptLimit:MAX_TASK_ATTEMPTS}});
  if(!plan.steps.length||plan.steps.some(step=>!allowed.has(step.command)))
    return finish('blocked',[{command:null,status:'blocked',
      summary:'Unsupported step: no execution occurred'}]);
  const receipts=[];
  for(const step of plan.steps){
    try{
      let summary='',details={};
      switch(step.command){
        case '/help':
          summary='Cloud command allowlist';details={commands:[...allowed],capabilities:capabilityManifest('cloud')};break;
        case '/system status':
          summary='GitHub-hosted runner executed';details={ephemeral:true,desktopRequired:false};break;
        case '/learning status':
          summary='Cloud learning evidence not yet connected';details={qualifiedExperiences:0,promotions:0};break;
        case '/repo inspect':{
          const r=await get('/repos/'+REPOSITORY+'/git/ref/heads/main'), main=r?.object?.sha;
          if(!sha.test(main||''))throw Error('Invalid main');
          const c=await get('/repos/'+REPOSITORY+'/git/commits/'+main), tree=c?.tree?.sha;
          if(!sha.test(tree||''))throw Error('Invalid tree');
          const result=await get('/repos/'+REPOSITORY+'/git/trees/'+tree+'?recursive=1');
          if(result?.truncated===true||!Array.isArray(result?.tree))throw Error('Incomplete tree');
          const files=result.tree.filter(x=>x.type==='blob');
          summary='GitHub main independently inspected';
          details={mainSha:main,fileCount:files.length};
          break;
        }
        default:throw Error('Unsupported command');
      }
      receipts.push({command:step.command,status:'succeeded',summary,details});
    }catch{
      receipts.push({command:step.command,status:'failed',summary:'GitHub read could not be verified'});
    }
  }
  const successes=receipts.filter(x=>x.status==='succeeded').length;
  return finish(successes===receipts.length?'succeeded':successes?'partial':'failed',receipts);
}
export function parseReceiptComment(comment){
  if(comment?.user?.login!=='github-actions[bot]'||typeof comment.body!=='string'||
    !comment.body.startsWith(MARKER+'\n'))return null;
  const structured=comment.body.split('\nStructured receipt:\n')[1]?.split('\n\nThis job')[0];
  try{
    const receipt=JSON.parse(structured);
    return ['ultron.cloud.receipt.v1',RECEIPT_SCHEMA].includes(receipt?.schema)?receipt:null;
  }catch{return null;}
}
export function formatReceipt(outcome){
  if(outcome?.schema!==RECEIPT_SCHEMA)throw Error('Bad receipt');
  const rows=outcome.receipts.map((r,i)=>(i+1)+'. '+(r.command||'Blocked')+' — '+r.status+': '+r.summary);
  return [MARKER,'### Ultron cloud execution receipt','Status: '+outcome.status,
    'Cognitive recommendation: '+outcome.cognition.decision+' (advisory only)',
    'Attempt: '+outcome.attemptOrdinal+' of '+outcome.attemptLimit+
      '; retry: '+outcome.retry.disposition,
    'Source authority: exact current main '+(outcome.sourceAuthority?.preReceiptMainSha||'not recorded'),
    'Backend: GitHub-hosted Actions; PC required: No','',...rows,'',
    'Structured receipt:',JSON.stringify(outcome,null,2),
    '','This job did not execute shell commands, private PC actions, or model inference.'].join('\n');
}
