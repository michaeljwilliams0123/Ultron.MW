(()=>{
'use strict';
const $=id=>document.getElementById(id);
const button=$('connection-refresh'),stamp=$('connection-stamp');
const base='https://github.com/michaeljwilliams0123/Ultron.MW';
let refreshing=false;
const meta=(status,detail)=>{stamp.dataset.state=status;stamp.textContent=detail};
function cell(id,value,detail,state){
 const el=$(id);
 el.dataset.state=state;
 el.querySelector('.connection-value').textContent=value;
 el.querySelector('.connection-detail').textContent=detail;
}
function clock(iso){
 if(typeof iso!=='string'||!Number.isFinite(Date.parse(iso)))return 'time not verified';
 return new Date(iso).toLocaleString();
}
function line(label,detail,url){
 const item=document.createElement('li');
 const title=typeof url==='string'&&url.startsWith(base+'/')?document.createElement('a'):document.createElement('strong');
 title.textContent=label;
 if(title.tagName==='A'){title.href=url;title.target='_blank';title.rel='noopener noreferrer'}
 item.appendChild(title);
 const sub=document.createElement('small');sub.textContent=detail;item.appendChild(sub);
 return item;
}
function emptyRows(id,message){
 const list=$(id);list.replaceChildren(line(message,'No additional evidence available'));
}
function show(data){
 const runtime=data.runtime||{},github=data.github||{},ci=data.ci||{},
  queue=data.queue||{},prs=data.pullRequests||{};
 cell('connection-runtime',runtime.state==='active'?'Active':
  runtime.state==='paused'?'Paused':'Unavailable',
  runtime.state==='unavailable'?'Control readback missing':
  'PostgreSQL · last event '+clock(runtime.lastEventAt),
  runtime.state==='active'?'good':runtime.state==='paused'?'warning':'error');
 cell('connection-github',github.state==='observed'?'Main '+String(github.mainSha).slice(0,9):
  'Unverified',github.state==='observed'?'GitHub API · source SHA observed':
  String(github.reason||'GitHub observation unavailable'),
  github.state==='observed'?'good':'error');
 const ciState=ci.state==='observed'?(ci.conclusion||ci.status||'unknown'):
  ci.state==='no-current-main-run'?'No current-main run':'Unavailable';
 cell('connection-ci',ciState,
  ci.state==='observed'?'Current main · '+clock(ci.observedAt):
  ci.state==='no-current-main-run'?'No workflow found for observed main SHA':
  String(ci.reason||'CI observation unavailable'),
  ci.conclusion==='success'?'good':ci.state==='unavailable'||ci.conclusion==='failure'?'error':'warning');
 const counts=queue.counts||{},pending=(Number(counts.queued)||0)+(Number(counts.leased)||0),
  blocked=Number(counts.blocked)||0;
 cell('connection-queue',queue.state==='observed'?String(pending)+' pending':'Unavailable',
  queue.state==='observed'?String(Number(counts.done)||0)+' completed · '+blocked+' blocked':
  'Task ledger readback unavailable',
  queue.state==='observed'?(blocked?'warning':'good'):'error');
 const prList=$('connection-prs');prList.replaceChildren();
 if(prs.state==='observed'&&Array.isArray(prs.items)&&prs.items.length){
  for(const pr of prs.items.slice(0,6))
   prList.appendChild(line('#'+pr.number+' · '+String(pr.title).slice(0,110),
    (pr.draft?'Draft · ':'')+'Updated '+clock(pr.updatedAt),pr.url));
 }else emptyRows('connection-prs',prs.state==='observed'?'No open PRs in sample':'GitHub PRs could not be verified');
 const tasks=$('connection-recent');tasks.replaceChildren();
 if(queue.state==='observed'&&Array.isArray(queue.recent)&&queue.recent.length)
  for(const task of queue.recent.slice(0,6))
   tasks.appendChild(line('Task '+task.id+' · '+task.objective,
    task.status+' · '+clock(task.updatedAt)));
 else emptyRows('connection-recent','No verified task history available');
 meta('ok','Observed '+clock(data.observedAt)+' · live on-demand snapshot; no background polling');
}
async function fail(text,needsSession=false){
 for(const id of ['connection-runtime','connection-github','connection-ci','connection-queue'])
  cell(id,needsSession?'Sign in':'Unverified',needsSession?'Sign in to view protected connection status':'No owner readback obtained',needsSession?'warning':'error');
 emptyRows('connection-prs','No verified owner PR data');
 emptyRows('connection-recent','No verified owner task data');
 // This public health check contains no owner objectives, tokens or permissions.
 // It provides only a clearly qualified liveness signal during sign-in.
 try {
  const response=await fetch('/api/brain/status-public',{method:'GET',
   cache:'no-store',credentials:'same-origin'});
  if(response.ok){
   const snapshot=await response.json();
   if(snapshot?.ok===true&&['active','paused'].includes(snapshot.status))
    cell('connection-runtime',snapshot.status==='active'?'Online (public)':'Paused (public)',
     'Public liveness only · owner session required for protected details',
     snapshot.status==='active'?'warning':'error');
  }
 }catch{}
 if(needsSession)meta('session',text);
 else meta('error',text);
}
async function refresh(){
 if(refreshing)return;
 refreshing=true;button.disabled=true;meta('loading','Rechecking Hatchable, PostgreSQL and GitHub…');
 try{
  const response=await fetch('/api/brain/connectivity',{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error(response.status===401||response.status===403?
   'owner-authentication-required':'Connectivity HTTP '+response.status);
  const data=await response.json();
  if(data.schema!=='ultron.connectivity.v1'||!data.observedAt)throw Error('Invalid status readback');
  show(data);
 }catch(error){
  const needsSession=error?.message==='owner-authentication-required';
  await fail(needsSession?'Owner sign-in required to view protected connections. Public runtime health is shown when available.':
   'Connectivity unverified: '+String(error.message||error)+'. Protected connections are not assumed healthy.',needsSession);
 }
 finally{button.disabled=false;refreshing=false}
}
button.addEventListener('click',refresh);
window.addEventListener('ultron:task-queued',refresh);
window.addEventListener('ultron:realtime-change',refresh);
refresh();
})();
