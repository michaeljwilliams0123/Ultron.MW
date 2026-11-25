/** Diagnostic routing only. This module cannot authorize a merge or release. */
const SHA=/^[a-f0-9]{40}$/;
const REPO='michaeljwilliams0123/Ultron.MW',REPO_ID=1424939667;
const GATE_APP_ID=5765239,GATE_WORKFLOW_ID=416079861;
const SCHEMA='ultron.council-hold-remediation.v1';
const MODEL_ROLES=['Builder','Skeptic','Sentinel'];
const transient=/^(?:http-429|http-5[0-9]{2}|error|timeout)$/;
const pos=n=>Number.isSafeInteger(n)&&n>0;
const repoOk=r=>r?.id===REPO_ID&&r.full_name===REPO;
const exact=(p,q)=>p?.number===q?.number&&p?.head?.sha===q?.head?.sha&&p?.base?.sha===q?.base?.sha;
const safePr=p=>p?.state==='open'&&pos(p.number)&&p.base?.ref==='main'&&repoOk(p.base.repo)&&repoOk(p.head?.repo)&&SHA.test(p.head.sha)&&SHA.test(p.base.sha);
const usable=p=>p?.schema===SCHEMA&&pos(p.prNumber)&&SHA.test(p.sourceSha)&&SHA.test(p.baseSha)&&p.authorization==='held';
const routes=new Set(['retry-model','collect-evidence','investigate','restore-provider','owner-review']);
export function planCouncilRemediation({result,receipt}={}){
 const r=result||{},models=receipt?.modelReview?.results||{};
 if(!pos(r.prNumber)||!SHA.test(r.sourceSha||'')||!SHA.test(r.baseSha||''))return null;
 const base={schema:SCHEMA,prNumber:r.prNumber,sourceSha:r.sourceSha,baseSha:r.baseSha,
  authorization:['accepted','accepted-owner-routine','owner-overridden'].includes(r.status)?'accepted':'held',ownerRequired:r.securitySensitive!==false,route:'none',
  transientRoles:[],unavailableRoles:[],dissentRoles:[]};
 if(base.authorization==='accepted')return Object.freeze(base);
 for(const role of MODEL_ROLES){
  const m=models[role];
  if(m?.source==='model'&&m.modelInvoked===true){
   if(m.verdict!=='proceed'||!Array.isArray(m.disagreements)||m.disagreements.length)base.dissentRoles.push(role);
  }else if((r.modelHoldRoles||[]).includes(role)){
   const failures=Array.isArray(m?.attempts)?m.attempts.filter(a=>a.outcome!=='no-credential'):[];
   if(m?.fallbackReason==='free-tier-exhausted-or-failed'&&failures.length&&failures.every(a=>transient.test(a.outcome)))base.transientRoles.push(role);
   else base.unavailableRoles.push(role);
  }
 }
 if(base.ownerRequired)base.route='owner-review';
 else if(['missing-or-stale-council-evidence','missing-or-duplicate-role','missing-or-duplicate-publication','incomplete-role-evidence','changed-file-list-incomplete','changed-file-list-invalid'].includes(r.reason))base.route='collect-evidence';
 else if(base.dissentRoles.length||r.approvedCount!==7||(r.holdRoles||[]).length)base.route='investigate';
 else if(base.unavailableRoles.length)base.route='restore-provider';
 else if(base.transientRoles.length)base.route='retry-model';
 else base.route='investigate';
 return Object.freeze(base);
}
export function readRemediationCheck(check,pr){
 if(!safePr(pr)||check?.app?.id!==GATE_APP_ID||check.name!=='ultron/council-7of7'||check.head_sha!==pr.head.sha||check.status!=='completed'||check.conclusion!=='failure')return null;
 try{
  if(typeof check.output?.text!=='string'||check.output.text.length>4096)return null;
  const p=JSON.parse(check.output.text);
  if(!usable(p)||!routes.has(p.route)||p.prNumber!==pr.number||p.sourceSha!==pr.head.sha||p.baseSha!==pr.base.sha)return null;
  if(p.ownerRequired!==false&&p.route!=='owner-review')return null;
  return p;
 }catch{return null;}
}
export function selectCouncilRetry({pr,check,run,now=Date.now(),priorRetry=false}={}){
 const p=readRemediationCheck(check,pr);
 if(!p||p.ownerRequired||!['retry-model','collect-evidence'].includes(p.route)||priorRetry)return null;
 const age=now-Date.parse(check.completed_at);
 if(!Number.isFinite(age)||age<15*60000||age>48*3600000)return null;
 if(!pos(run?.id)||run.workflow_id!==GATE_WORKFLOW_ID||run.status!=='completed'||run.run_attempt!==1||!repoOk(run.repository))return null;
 const url='https://github.com/'+REPO+'/actions/runs/'+run.id;
 if(check.details_url!==url||run.html_url!==url)return null;
 return Object.freeze({runId:run.id,prNumber:pr.number,sourceSha:pr.head.sha,baseSha:pr.base.sha});
}
export function councilRemediationIssue(p){
 if(!usable(p)||!routes.has(p.route))return null;
 const marker='<!-- ULTRON_COUNCIL_HOLD_V1 '+p.prNumber+' '+p.sourceSha+' '+p.baseSha+' -->';
 const roles=a=>Array.isArray(a)?MODEL_ROLES.filter(r=>a.includes(r)).join(', ')||'none':'unknown';
 return {marker,title:'[Council remediation] PR #'+p.prNumber+' — '+p.route,
  body:[marker,'Exact-head Council investigation; this is not approval or a request to execute untrusted code.',
   'PR: #'+p.prNumber,'Head: '+p.sourceSha,'Base: '+p.baseSha,'Route: '+p.route,
   'Transient models: '+roles(p.transientRoles),'Unavailable models: '+roles(p.unavailableRoles),'Model dissent: '+roles(p.dissentRoles),
   'Sentinel: collect the exact-head check and provider evidence. Skeptic: independently reproduce any concrete defect before routing a bounded draft fix through the existing self-repair lane. Builder: add a failing-then-passing test for a verified defect. Reevaluate on the new head.',
   p.ownerRequired?'Steward: critical change requires owner authorization; no automatic governance edits.':'Steward: escalate only after bounded recovery or unresolved material risk.',
   'No merge, deploy, credential change, paid inference or signed-owner exception is authorized by this issue.'].join('\n\n')};
}
export {exact as sameRemediationHead};
