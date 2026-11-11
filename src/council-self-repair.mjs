/** Council self-repair loop: Sentinel diagnoses, Builder repairs, Skeptic
 * reviews, Steward escalates, Ultron Core routes. Pure planning logic; the
 * GitHub adapter lives in scripts/council-self-repair.mjs.
 *
 * Safety contract (modelled on Grok Bots: background workers return drafts,
 * consequential actions become approval cards for the owner):
 *  - Default mode is `report-only`: diagnose and write a summary, no writes.
 *  - `act` mode may only: rerun a whole workflow once on the same head when
 *    GitHub lost jobs, open/update ONE labeled diagnosis issue per failure
 *    signature, optionally hand that issue to an agent for a DRAFT fix PR,
 *    and update-branch (merge, never force-push) stale owner-authored drafts.
 *  - Merges, releases, deploys, secrets, permissions and settings are never
 *    planned; they are escalated to the owner (OWNER_ONLY_OPERATIONS).
 */
import {classifyVerifyRun,VERIFY_WORKFLOW} from './ci-job-presence.mjs';
import {OWNER_ONLY_OPERATIONS} from './council-of-ultron.mjs';

export const REPO='michaeljwilliams0123/Ultron.MW';
export const SELF_REPAIR_MODES=Object.freeze(['off','report-only','act']);
export const OWNER_AUTHORS=Object.freeze([
  Object.freeze({login:'michaeljwilliams0123',id:308995719}),
  Object.freeze({login:'michaeljwilliams0123ultron',id:354634860}),
]);
export const SELF_REPAIR_LABELS=Object.freeze(['self-repair','council:sentinel']);
export const ALLOWED_OPS=Object.freeze(['workflow.rerun','issue.upsert','agent.assign',
  'pr.update-branch','verify.dispatch','owner.escalate','skeptic.review','draft.handoff']);
const NOTE_ONLY=new Set(['skeptic.review','draft.handoff']);
const MARK='<!-- ULTRON_SELF_REPAIR_V1 ';
const FAILED=new Set(['failure','timed_out','startup_failure']);
// A failure that touches these is the owner's call, never an automatic repair.
const PROTECTED=/(^|\/)\.github\/|secret|credential|token|permission|ruleset|release|deploy|branch protection/i;

/** Unknown or empty config falls back to the safe default. */
export function resolveMode(value){
  const v=String(value||'').trim().toLowerCase();
  return SELF_REPAIR_MODES.includes(v)?v:'report-only';
}
export function isOwnerPr(pr){
  return Boolean(pr&&pr.head?.repo?.full_name===REPO&&pr.base?.repo?.full_name===REPO&&
    OWNER_AUTHORS.some(a=>a.login===pr.user?.login&&a.id===pr.user?.id));
}

/** Sentinel: classify one completed workflow run.
 * @returns {{scope,category,reason,failedJobs,failedSteps,signature,...}} */
export function diagnoseRun({run,jobs,pullRequest=null,annotations=[]}={}){
  if(!run||!Number.isSafeInteger(run.id))return Object.freeze({category:'invalid',reason:'run unreadable'});
  const onMain=run.head_branch==='main'&&['push','schedule','workflow_dispatch'].includes(run.event)&&
    (!run.head_repository||run.head_repository.full_name===REPO);
  const ownerPr=run.event==='pull_request'&&isOwnerPr(pullRequest)&&pullRequest.head?.sha===run.head_sha;
  const scope=onMain?'main':ownerPr?'pr#'+pullRequest.number:null;
  const base={runId:run.id,runAttempt:run.run_attempt??1,workflowPath:String(run.path||'').replace(/@.*$/,''),
    workflowName:run.name,event:run.event,headSha:run.head_sha,headBranch:run.head_branch,
    runUrl:run.html_url||'https://github.com/'+REPO+'/actions/runs/'+run.id,scope};
  if(!scope)return Object.freeze({...base,category:'out-of-scope',
    reason:'not main and not an owner-authored same-repo PR',failedJobs:[],failedSteps:[],signature:null});
  if(run.status!=='completed')return Object.freeze({...base,category:'pending',reason:'run not terminal',
    failedJobs:[],failedSteps:[],signature:null});
  const list=Array.isArray(jobs?.jobs)?jobs.jobs:[];
  const failedJobs=list.filter(j=>FAILED.has(j?.conclusion)).map(j=>String(j.name));
  const failedSteps=list.flatMap(j=>(j.steps||[]).filter(s=>FAILED.has(s?.conclusion))
    .map(s=>String(j.name)+' / '+String(s.name)));
  let category,reason;
  if(base.workflowPath===VERIFY_WORKFLOW.path){
    const presence=classifyVerifyRun({run:{...run,path:base.workflowPath},jobs,pullRequest,annotations});
    if(presence.state==='green'){category='green';reason=presence.reason;}
    else if(presence.state==='unknown-missing'){category='outage-missing-jobs';reason=presence.reason;}
    else if(presence.state==='pending'){category='pending';reason=presence.reason;}
    else if(presence.state==='red'){category='real-failure';reason=presence.reason;}
    else{category='invalid';reason=presence.reason;}
  }else if(run.conclusion==='success'||run.conclusion==='skipped'||run.conclusion==='neutral'){
    category='green';reason='run concluded '+run.conclusion;
  }else if(run.conclusion==='cancelled'){
    category='cancelled';reason='cancelled (superseded or manual); not a repair signal';
  }else if(Number.isSafeInteger(jobs?.total_count)&&jobs.total_count===0){
    category='outage-missing-jobs';reason='GitHub created no jobs';
  }else if(annotations.some(m=>/Internal server error|not acquired by Runner|hosted runner encountered an error/i.test(String(m)))){
    category='outage-missing-jobs';reason='GitHub service-side error';
  }else{category='real-failure';reason='concluded '+run.conclusion;}
  const signature=category==='real-failure'?
    [base.workflowPath,scope,...[...failedJobs].sort()].join('|'):null;
  return Object.freeze({...base,category,reason,failedJobs:Object.freeze(failedJobs),
    failedSteps:Object.freeze(failedSteps),signature});
}

export function issueMarker(signature){return MARK+'key='+signature+' -->';}
export function findIssueForSignature(issues,signature){
  const marker=issueMarker(signature);
  return (Array.isArray(issues)?issues:[]).find(i=>!i.pull_request&&String(i.body||'').includes(marker))||null;
}

/** Log text is untrusted: redact secrets, defang mentions and fences, bound size. */
export function sanitizeLog(text,max=4000){
  return String(text||'').slice(-max)
    .replace(/\x1b\[[0-9;]*m/g,'')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gsk_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{15,})\b/g,'[redacted]')
    .replace(/(Authorization\s*:\s*Bearer\s+)\S+/gi,'$1[redacted]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,'[redacted key]')
    .replace(/@(?=[A-Za-z0-9-])/g,'@\u200b')
    .replace(/```/g,"'''");
}

/** Ultron Core: turn a diagnosis into role-attributed, allow-listed actions. */
export function planRepair(diagnosis,{mode='report-only',existingIssue=null,agent='none',
  changedPaths=[]}={}){
  const m=resolveMode(mode);
  const actions=[];
  const add=(op,role,why,extra={})=>actions.push(Object.freeze({op,role,why,...extra}));
  const d=diagnosis||{};
  if(m==='off'||!d.scope)return finish(m,d,actions);
  if(d.category==='outage-missing-jobs'){
    if((d.runAttempt??1)===1)add('workflow.rerun','Sentinel',
      'GitHub lost jobs on this run; rerun the whole workflow once on the same head.',{runId:d.runId});
    else add('owner.escalate','Steward','Rerun already attempted and jobs are still missing; owner decides.');
  }
  if(d.category==='real-failure'){
    const protectedTouch=changedPaths.some(p=>PROTECTED.test(p))||
      Boolean(d.failedSteps?.some(s=>PROTECTED.test(s)));
    add('issue.upsert','Sentinel',existingIssue?'Same failure signature: update the open diagnosis issue.':
      'Open one diagnosis issue for this failure signature.',
      {issueNumber:existingIssue?.number??null,signature:d.signature,
        labels:[...SELF_REPAIR_LABELS,protectedTouch?'needs-owner':'council:builder']});
    if(protectedTouch)add('owner.escalate','Steward',
      'Failure touches workflows, credentials, permissions or release paths: owner decision, no automatic fix.');
    else if(agent==='copilot'&&!existingIssue?.assignees?.length)add('agent.assign','Builder',
      'Hand the diagnosis to the Copilot coding agent for a DRAFT fix PR against main.',{agent:'copilot'});
    else add('draft.handoff','Builder','Fix stays a draft; Builder or the owner opens it (Codex `/codex run` remains owner-triggered).');
    add('skeptic.review','Skeptic','Any fix PR stays draft until Skeptic has a falsifying test and CI is green on its exact head.');
  }
  return finish(m,d,actions);
}
function finish(mode,diagnosis,actions){
  for(const a of actions){
    if(!ALLOWED_OPS.includes(a.op)||OWNER_ONLY_OPERATIONS.includes(a.op))
      throw Error('self-repair-op-not-allowed:'+a.op);
  }
  const writes=actions.filter(a=>!NOTE_ONLY.has(a.op));
  return Object.freeze({mode,category:diagnosis.category||'invalid',scope:diagnosis.scope||null,
    actions:Object.freeze(actions),
    execute:mode==='act'&&writes.length>0,
    approvalCards:Object.freeze(actions.filter(a=>a.op==='owner.escalate').map(a=>Object.freeze(
      {kind:'approval',to:'owner',reason:a.why,runUrl:diagnosis.runUrl||null})))});
}

/** Builder: owner-authored, same-repo drafts that fell behind main. */
export function selectStaleDrafts(prs,{now=Date.now(),staleHours=24,limit=5}={}){
  return (Array.isArray(prs)?prs:[]).filter(pr=>pr?.state==='open'&&pr.draft===true&&isOwnerPr(pr)&&
    pr.base?.ref==='main'&&/^[a-f0-9]{40}$/.test(pr.head?.sha||'')&&
    now-Date.parse(pr.updated_at||0)>=staleHours*3600000)
    .sort((a,b)=>Date.parse(a.updated_at)-Date.parse(b.updated_at)).slice(0,limit);
}
/** Only `behind` is updated; conflicts (`dirty`) become a note, never a rebase. */
export function planBranchUpdate(pr,detail){
  if(detail?.mergeable_state==='behind')return Object.freeze({op:'pr.update-branch',role:'Builder',
    number:pr.number,expectedHeadSha:pr.head.sha,
    why:'Draft is behind main: merge main in (no force-push), then dispatch Verify on the branch.'});
  if(detail?.mergeable_state==='dirty')return Object.freeze({op:'owner.escalate',role:'Steward',number:pr.number,
    why:'Draft has merge conflicts with main; needs the author.'});
  return null;
}

export function renderIssue(diagnosis,plan,{logTail=''}={}){
  const d=diagnosis;
  const lines=[issueMarker(d.signature),
    '## Self-repair diagnosis: '+(d.workflowName||d.workflowPath)+' on '+d.scope,'',
    '- Run: '+d.runUrl+' (attempt '+d.runAttempt+')',
    '- Head: `'+d.headSha+'` on `'+d.headBranch+'`, event `'+d.event+'`',
    '- Category: **'+d.category+'**: '+d.reason,
    '- Failed jobs: '+(d.failedJobs.length?d.failedJobs.map(j=>'`'+j+'`').join(', '):'none reported'),
    '- Failed steps: '+(d.failedSteps.length?d.failedSteps.map(s=>'`'+s+'`').join(', '):'none reported'),'',
    '### Council plan','',
    ...plan.actions.map(a=>'- **'+a.role+'** `'+a.op+'`: '+a.why),'',
    '### Log tail (untrusted, redacted)','','```text',sanitizeLog(logTail),'```','',
    'Fixes land as **draft** PRs only. Merges, releases, deploys, secrets and permissions stay with the owner.'];
  return lines.join('\n');
}
