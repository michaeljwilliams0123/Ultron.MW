#!/usr/bin/env node
/** Council self-repair adapter. Modes come from SELF_REPAIR_MODE (repository
 * variable ULTRON_SELF_REPAIR_MODE): off | report-only (default) | act.
 *
 *   --run <id>   diagnose one completed run (workflow_run / dispatch)
 *   --sweep      recent failed runs on main + stale owner drafts (schedule)
 *   --execute    perform the planned allow-listed writes (act mode only)
 *
 * Without --execute nothing is written: the plan goes to the step summary.
 * Never checks out or runs PR code; log text is treated as untrusted data. */
import {appendFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {REPO,resolveMode,diagnoseRun,planRepair,findIssueForSignature,renderIssue,
  selectStaleDrafts,planBranchUpdate,SELF_REPAIR_LABELS} from '../src/council-self-repair.mjs';

const API='https://api.github.com/repos/'+REPO;
export function githubClient(token,fetchImpl=fetch){
  const call=async(method,path,body,{text=false}={})=>{
    const response=await fetchImpl(path.startsWith('http')?path:API+path,{method,headers:{
      authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28',
      ...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(!response.ok)throw Error(method+' '+path.split('?')[0]+' -> '+response.status);
    if(response.status===204)return null;
    return text?response.text():response.json();
  };
  return {get:(p,o)=>call('GET',p,null,o),post:(p,b)=>call('POST',p,b),put:(p,b)=>call('PUT',p,b),
    patch:(p,b)=>call('PATCH',p,b)};
}

async function readRun(gh,runId){
  const run=await gh.get('/actions/runs/'+runId);
  const jobs=await gh.get('/actions/runs/'+runId+'/jobs?filter=latest&per_page=100');
  let pullRequest=null;
  if(run.event==='pull_request'&&run.pull_requests?.[0]?.number)
    pullRequest=await gh.get('/pulls/'+run.pull_requests[0].number).catch(()=>null);
  let logTail='';
  const failed=(jobs.jobs||[]).find(j=>j.conclusion==='failure');
  if(failed)logTail=String(await gh.get('/actions/jobs/'+failed.id+'/logs',{text:true}).catch(()=>'')).slice(-6000);
  let changedPaths=[];
  if(pullRequest)changedPaths=(await gh.get('/pulls/'+pullRequest.number+'/files?per_page=100').catch(()=>[]))
    .map(f=>f.filename);
  return {run,jobs,pullRequest,logTail,changedPaths};
}

/** One run end-to-end. `execute` false => plan only. */
export async function handleRun(gh,runId,{mode,agent='none',execute=false,assignToken=null}={}){
  const {run,jobs,pullRequest,logTail,changedPaths}=await readRun(gh,runId);
  const diagnosis=diagnoseRun({run,jobs,pullRequest});
  let existingIssue=null;
  if(diagnosis.signature){
    const open=await gh.get('/issues?state=open&labels='+encodeURIComponent(SELF_REPAIR_LABELS[0])+'&per_page=100');
    existingIssue=findIssueForSignature(open,diagnosis.signature);
  }
  const plan=planRepair(diagnosis,{mode,existingIssue,agent,changedPaths});
  const done=[];
  if(execute&&plan.execute){
    for(const a of plan.actions){
      if(a.op==='workflow.rerun'){await gh.post('/actions/runs/'+a.runId+'/rerun',{});done.push('reran '+a.runId);}
      if(a.op==='issue.upsert'){
        const body=renderIssue(diagnosis,plan,{logTail});
        if(existingIssue){
          await gh.post('/issues/'+existingIssue.number+'/comments',{body:'Recurred: '+diagnosis.runUrl+
            ' (attempt '+diagnosis.runAttempt+', head `'+diagnosis.headSha+'`).'});
          done.push('updated #'+existingIssue.number);
        }else{
          const created=await gh.post('/issues',{title:'[self-repair] '+(diagnosis.workflowName||'workflow')+
            ' failing on '+diagnosis.scope+': '+(diagnosis.failedJobs.join(', ')||diagnosis.category),
            body,labels:a.labels});
          existingIssue=created;done.push('opened #'+created.number);
        }
      }
      if(a.op==='agent.assign'&&existingIssue){
        if(!assignToken){done.push('copilot assignment skipped: no user token configured');continue;}
        // Copilot assignment requires a user token; installation tokens are refused.
        await githubClient(assignToken).post('/issues/'+existingIssue.number+'/assignees',{
          assignees:['copilot-swe-agent[bot]'],
          agent_assignment:{target_repo:REPO,base_branch:'main',
            custom_instructions:'Open a DRAFT pull request only. Do not change .github/workflows, secrets, permissions or release files.'}});
        done.push('assigned Copilot to #'+existingIssue.number);
      }
      if(a.op==='owner.escalate'&&existingIssue&&!existingIssue.labels?.some?.(l=>(l.name||l)==='needs-owner')){
        await gh.post('/issues/'+existingIssue.number+'/labels',{labels:['needs-owner']});
        done.push('escalated #'+existingIssue.number+' to owner');
      }
    }
  }
  return {diagnosis,plan,done};
}

/** Builder sweep over stale owner drafts. */
export async function sweepDrafts(gh,{execute=false,now=Date.now(),staleHours=24}={}){
  const prs=await gh.get('/pulls?state=open&base=main&per_page=100');
  const results=[];
  for(const pr of selectStaleDrafts(prs,{now,staleHours})){
    const detail=await gh.get('/pulls/'+pr.number);
    const step=planBranchUpdate(pr,detail);
    if(!step)continue;
    let done=null;
    if(execute&&step.op==='pr.update-branch'){
      await gh.put('/pulls/'+pr.number+'/update-branch',{expected_head_sha:step.expectedHeadSha});
      // GITHUB_TOKEN pushes do not trigger pull_request runs; dispatch Verify on the branch.
      await gh.post('/actions/workflows/verify.yml/dispatches',{ref:pr.head.ref});
      done='updated #'+pr.number+' and dispatched Verify on '+pr.head.ref;
    }
    results.push({number:pr.number,step,done});
  }
  return results;
}

export function renderSummary({mode,runs=[],drafts=[],executed}){
  const out=['## Council self-repair ('+mode+(executed?', executing':', plan only')+')',''];
  if(!runs.length&&!drafts.length)out.push('Nothing to repair.');
  for(const r of runs){
    out.push('### '+(r.diagnosis.workflowName||r.diagnosis.workflowPath)+' run '+r.diagnosis.runUrl,
      '- Scope: '+(r.diagnosis.scope||'out of scope')+'; category **'+r.diagnosis.category+'**: '+r.diagnosis.reason);
    for(const a of r.plan.actions)out.push('- '+a.role+' `'+a.op+'`: '+a.why);
    for(const c of r.plan.approvalCards)out.push('- Approval card for owner: '+c.reason);
    for(const d of r.done)out.push('- done: '+d);
  }
  for(const d of drafts)out.push('- Draft #'+d.number+': '+d.step.role+' `'+d.step.op+'`: '+d.step.why+(d.done?' ('+d.done+')':''));
  return out.join('\n')+'\n';
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const mode=resolveMode(process.env.SELF_REPAIR_MODE);
  const execute=process.argv.includes('--execute')&&mode==='act';
  const agent=process.env.SELF_REPAIR_AGENT==='copilot'?'copilot':'none';
  const gh=githubClient(process.env.GITHUB_TOKEN);
  const runs=[],drafts=[];
  if(mode!=='off'){
    const i=process.argv.indexOf('--run');
    const ids=[];
    if(i>0&&/^\d+$/.test(process.argv[i+1]||''))ids.push(process.argv[i+1]);
    if(process.argv.includes('--sweep')){
      const since=new Date(Date.now()-6*3600000).toISOString();
      const recent=await gh.get('/actions/runs?branch=main&status=failure&per_page=50&created=%3E%3D'+since);
      for(const r of recent.workflow_runs||[])if(!ids.includes(String(r.id)))ids.push(String(r.id));
    }
    for(const id of ids.slice(0,10)){
      try{runs.push(await handleRun(gh,id,{mode,agent,execute,assignToken:process.env.SELF_REPAIR_ASSIGN_TOKEN||null}));}
      catch(e){console.log('run '+id+' unavailable: '+e.message);}
    }
    if(process.argv.includes('--sweep'))drafts.push(...await sweepDrafts(gh,{execute}).catch(()=>[]));
  }
  const summary=renderSummary({mode,runs,drafts,executed:execute});
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  writeFileSync('self-repair-plan.json',JSON.stringify({mode,runs:runs.map(r=>({diagnosis:r.diagnosis,plan:r.plan,done:r.done})),drafts},null,2));
  const wantsAct=mode==='act'&&(runs.some(r=>r.plan.execute)||drafts.some(d=>d.step.op==='pr.update-branch'));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'act='+wantsAct+'\n');
  console.log(summary);
}
