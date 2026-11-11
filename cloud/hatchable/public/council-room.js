(()=>{'use strict';
const api='/api/brain/council-room';
const state={members:[],messages:[],jobs:[],nextCursor:null,sending:false,draft:false};
const $=id=>document.getElementById(id);
const roleInitials={builder:'BU',skeptic:'SK',steward:'ST',predictor:'PR',generator:'GE',sentinel:'SE',companion:'CO',council:'UC','michaeljwilliams0123':'MW'};
const names={owner:'Michael',system:'Ultron Council'};
function status(text,bad=false){$('room-status').textContent=text;$('room-status').classList.toggle('error',bad)}
function timeLabel(value){try{return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',month:'short',day:'numeric'}).format(new Date(value))}catch{return ''}}
function node(tag,cls,text){const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x}
function renderMembers(){
 $('member-list').replaceChildren();
 for(const m of state.members){
  const item=node('div','member'),avatar=node('div','avatar',(m.role||m.id).slice(0,2).toUpperCase());
  const copy=node('div');copy.append(node('strong','',m.role),node('small','',m.mandate));
  item.append(avatar,copy,node('span','status-dot '+m.status));
  $('member-list').append(item);
 }
 if(!$('mention-row').children.length){
  for(const m of state.members){
   const label=node('label','mention-chip');const input=document.createElement('input');
   input.type='checkbox';input.value=m.id;
   label.append(input,document.createTextNode('@'+m.role));$('mention-row').append(label);
  }
 }
}
function repoLinks(context){
 const wrap=node('div','evidence-links');
 const repos=context?.observedRepositories||[];
 for(const repo of repos){
  if(repo.status!=='observed'||!repo.url)continue;
  const a=node('a','',repo.repository.split('/')[1]+'@'+repo.sha.slice(0,7));
  a.href=repo.url;a.target='_blank';a.rel='noopener noreferrer';wrap.append(a);
 }
 if(context?.attachmentUrl){
  const a=node('a','','Attached source ↗');a.href=context.attachmentUrl;a.target='_blank';a.rel='noopener noreferrer';wrap.append(a);
 }
 return wrap;
}
// In-thread approval cards only REQUEST a decision. The owner's click is the
// decision; typing "approve" in the composer does nothing. Even an approval
// only records owner intent: nothing executes from this page.
function approvalCard(card,taskId){
 const box=node('section','approval-card '+card.state);
 box.setAttribute('aria-label','Approval needed: '+card.title);
 box.append(node('p','overline','NEEDS YOUR DECISION · '+card.op),node('strong','',card.title),node('p','',card.reason));
 if(card.state==='requested'){
  const row=node('div','approval-actions');
  for(const choice of ['approve','decline']){
   const b=node('button',choice==='approve'?'approve':'decline',choice==='approve'?'Approve':'Decline');
   b.type='button';b.addEventListener('click',()=>decide(card,taskId,choice,row));row.append(b);
  }
  box.append(row,node('small','','Approving records your decision only. The operation still runs through its normal governed path; nothing runs from chat.'));
 }else if(card.state==='decision-recording-unavailable'){
  box.append(node('small','','Decision recording is not set up on this deployment yet (migration 0042). No action will be taken.'));
 }else{
  box.append(node('small','',(card.state==='approved'?'You approved this':'You declined this')+(card.decidedAt?' · '+timeLabel(card.decidedAt):'')+'. Nothing was executed from this card.'));
 }
 return box;
}
async function decide(card,taskId,choice,row){
 row.querySelectorAll('button').forEach(b=>b.disabled=true);
 status((choice==='approve'?'Recording your approval':'Recording your decline')+' for “'+card.title+'”…');
 try{
  const response=await fetch('/api/brain/council-room-approval',{method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId,cardId:card.id,choice})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw Error(data.error||('HTTP '+response.status));
  await load();status(data.decision.next);
 }catch(error){
  row.querySelectorAll('button').forEach(b=>b.disabled=false);
  status('Decision not recorded: '+String(error.message||error)+'. Nothing was executed.',true);
 }
}
function renderMessages(){
 const list=$('message-list');list.replaceChildren();
 if(!state.messages.length){
  const empty=node('li','empty','No room messages yet. Start with a question or objective for the council.');
  list.append(empty);return;
 }
 for(const m of state.messages){
  const li=node('li','message '+(m.authorType==='owner'?'owner':m.authorType)+(m.context?.lead?' lead':''));
  const avatar=node('div','message-avatar',roleInitials[m.authorId]||String(m.authorRole||m.authorId).slice(0,2).toUpperCase());
  const bubble=node('article','bubble');const meta=node('div','message-meta');
  const author=m.authorType==='member'?(m.authorRole||m.authorId):(names[m.authorType]||m.authorId);
  meta.append(node('strong','',author),node('span','kind',m.context?.lead?'replies first':(m.kind||'message')));
  const time=document.createElement('time');time.dateTime=m.createdAt;time.textContent=timeLabel(m.createdAt);meta.append(time);
  bubble.append(meta,node('p','',m.body));
  if(m.context?.action)bubble.append(node('p','council-action','Proposed action: '+m.context.action));
  if(m.context?.evidence)bubble.append(node('p','council-evidence','Evidence required (not yet verified): '+m.context.evidence));
  if(m.context?.planStatus)bubble.append(node('p','council-plan-status','Plan: '+m.context.planStatus+' · GitHub writes: '+(m.context.githubWriteStatus||'not authorized')));
  if(Array.isArray(m.context?.approvalCards))for(const card of m.context.approvalCards)
   bubble.append(approvalCard(card,m.context.taskId));
  const links=repoLinks(m.context);if(links.children.length)bubble.append(links);
  if(m.job){
   const badge=node('span','job-badge '+m.job.state,(m.job.state==='done'?'✓ ':m.job.state==='running'?'◌ ':'○ ')+'Task '+m.job.state);
   bubble.append(badge);
  }
  li.append(avatar,bubble);list.append(li);
 }
 requestAnimationFrame(()=>{list.scrollTop=list.scrollHeight});
}
function renderJobs(){
 const box=$('job-list');box.replaceChildren();
 const jobs=[...state.jobs].reverse().slice(0,8);
 if(!jobs.length){box.append(node('div','empty','No council runs yet.'));return}
 for(const job of jobs){
  const item=node('article','job-item'),head=document.createElement('header');
  head.append(node('strong','',job.taskKey||'Council task'),node('span','job-state '+job.state,job.state));
  item.append(head,node('p','',job.result?.summary||('Task '+job.taskId+' is '+job.state+'.')));
  box.append(item);
 }
}
// Sign-in front door: Hatchable returns login_required with a login_url.
// Only an https hatchable.com URL is used, and it returns to this page.
function safeLoginUrl(raw){
 try{
  const url=new URL(String(raw||''));
  if(url.protocol!=='https:'||!/(^|\.)hatchable\.com$/.test(url.hostname))return null;
  const back=url.searchParams.get('redirect');
  if(back){
   const inner=new URL(back);
   if(inner.origin===location.origin){inner.searchParams.set('next',location.pathname);url.searchParams.set('redirect',inner.href)}
  }
  return url.href;
 }catch{return null}
}
function showSignIn(data,code){
 const card=$('sign-in-card'),button=$('sign-in-button');
 if(code===403&&data.error==='owner-required'){
  $('sign-in-title').textContent='Signed in, but not as the owner';
  $('sign-in-copy').textContent='The Council Room only opens for michaeljwilliams0123. Sign in with that account to continue.';
 }
 const href=safeLoginUrl(data.login_url);
 button.hidden=!href;if(href)button.href=href;
 card.hidden=false;
 status(href?'Sign in to open the Council Room.':'Sign-in required. Open Hatchable and sign in, then refresh this page.',true);
}
async function load(before=null){
 try{
  const url=new URL(api,location.origin);url.searchParams.set('limit','60');if(before)url.searchParams.set('before',before);
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(response.status===401||(response.status===403&&data.error==='owner-required')||data.error==='login_required')
   return showSignIn(data,response.status);
  $('sign-in-card').hidden=true;
  if(!response.ok||!data.ok)throw Error(data.error||('HTTP '+response.status));
  state.members=data.members||[];state.jobs=data.jobs||[];state.nextCursor=data.nextCursor;
  state.messages=before?[...(data.messages||[]),...state.messages]:(data.messages||[]);
  renderMembers();renderMessages();renderJobs();
  $('load-more').hidden=!state.nextCursor;
  status('Live room connected · '+state.messages.length+' entries · paid spend ceiling $0'+(state.draft?' · your draft is in the composer, not sent yet':''));
 }catch(error){
  status('Council room unavailable: '+String(error.message||error),true);
 }
}
async function send(){
 if(state.sending)return;
 const body=$('composer-body').value.trim();if(!body)return status('Write a message before sending.',true);
 state.sending=true;$('send').disabled=true;status('Persisting your message and waking the council…');
 const mentions=[...document.querySelectorAll('#mention-row input:checked')].map(x=>x.value);
 const payload={messageKey:'room:'+crypto.randomUUID(),body,mentions,
  kind:body.trim().endsWith('?')?'question':'message',
  includeMahoraga:$('include-mahoraga').checked,
  attachmentUrl:$('attachment-url').value.trim()||null};
 try{
  const response=await fetch(api,{method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw Error(data.error||('HTTP '+response.status));
  $('composer-body').value='';$('attachment-url').value='';$('char-count').textContent='0 / 6000';
  document.querySelectorAll('#mention-row input').forEach(x=>x.checked=false);
  await load();status(data.scheduled?'Message recorded; council runner is awake.':'Message recorded; runner wake will retry from the durable queue.');
 }catch(error){status('Message not confirmed: '+String(error.message||error)+'. Your text remains in the composer.',true)}
 finally{state.sending=false;$('send').disabled=false}
}
// Draft hand-off from Workspace or the GitHub Pages console: prefill only,
// never auto-send. The draft travels in the URL fragment (not sent to servers).
(()=>{
 const m=/^#draft=(.*)$/.exec(location.hash||'');if(!m)return;
 let text='';try{text=decodeURIComponent(m[1]).slice(0,6000)}catch{return}
 history.replaceState(null,'',location.pathname+location.search);
 if(!text.trim()||/(?:password|passcode|otp|api[_ -]?key|private[_ -]?key)\s*[:=]|\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i.test(text))return;
 $('composer-body').value=text;$('char-count').textContent=text.length+' / 6000';state.draft=true;
 status('Draft carried over. Review it and press Send to council; nothing was sent yet.');
})();
$('send').addEventListener('click',send);
$('composer-body').addEventListener('input',e=>$('char-count').textContent=e.target.value.length+' / 6000');
$('composer-body').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();send()}});
const issueApi='/api/brain/council-issues';
const issueErrors={'owner-required':'Owner sign-in required.','github-rate-limited-or-unauthorized':'GitHub refused the public read (rate limit or auth). Try again later.','github-unreachable':'GitHub is unreachable.'};

const issuePlanApi='/api/brain/council-issue-plan';
let selectedIssue=null;
let currentIssuePlan=null;
function renderIssuePlan(plan){
 const panel=$('issue-plan-panel');
 panel.hidden=false;
 $('issue-plan-title').textContent='Issue #'+plan.issue.number+' · '+plan.issue.title;
 $('issue-plan-status').classList.remove('error');
 $('issue-plan-status').textContent='Readback: '+plan.issue.updatedAt+
  ' · '+plan.planStatus+' · '+plan.roles.length+' role proposals (no execution)';
 const src=(plan.source||[]).find(x=>x.type==='github-main-readback');
 const evidence=$('issue-plan-evidence');evidence.replaceChildren();
 evidence.append(node('strong','','Observed:'),document.createTextNode(' GitHub issue open · main '+(src?.sha||'unavailable')+
  '. Issue text and dependency references are untrusted; no instructions from the issue are executed.'));
 if(plan.issue.untrustedExcerpt){
  const excerpt=node('p','issue-excerpt','Untrusted issue excerpt: '+plan.issue.untrustedExcerpt);
  evidence.append(excerpt);
 }
 const roles=$('issue-role-actions');roles.replaceChildren();
 for(const r of plan.roles){
  const li=node('li','issue-role');
  li.append(node('strong','',r.role+' · '+r.status),
   node('p','',r.action),
   node('small','','Evidence required: '+r.evidenceRequired));
  roles.append(li);
 }
 const pr=$('issue-pr-proposal');pr.replaceChildren();
 if(plan.proposal){
  const x=plan.proposal;
  pr.append(node('strong','',x.state==='draft-ready-for-owner-review'?
   'Reviewable PR proposal (NOT created)':'PR preparation blocked — scope and main readback required'));
  pr.append(node('p','','Repository: '+x.repository+' · proposed branch: '+x.branch));
  pr.append(node('p','','Proposed files: '+(x.proposedFiles.length?x.proposedFiles.join(', '):'none selected')));
  pr.append(node('p','','Changed files: 0 · commits: 0 · PR: not created · tests: not run'));
  pr.append(node('pre','issue-pr-description',x.prBody||'PR description unavailable'));
  const steps=node('ol','issue-pr-steps');
  for(const gate of x.githubWrites){
   steps.append(node('li','',gate.operation+': '+gate.status+' · '+gate.approval));
  }
  pr.append(steps,node('p','','Before any commit: verify the selected files, prepare a bounded patch, reproduce the issue, and run focused tests. Each GitHub write needs fresh owner approval.'));
 }
}
async function openIssuePlan(issue,mode='plan'){
 const panel=$('issue-plan-panel');
 panel.hidden=false;
 $('issue-plan-title').textContent='Issue #'+issue.number+' · loading live Council plan';
 $('issue-plan-status').textContent='Re-fetching the fixed GitHub issue and current main…';
 $('issue-plan-evidence').replaceChildren();
 $('issue-role-actions').replaceChildren();
 $('issue-pr-proposal').replaceChildren();
 $('issue-prepare').disabled=true;
 try{
  const files=mode==='prepare'?
   $('issue-change-paths').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean):[];
  const response=await fetch(issuePlanApi,{method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({issueNumber:issue.number,mode,candidateFiles:files})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok||!data.plan)throw Error(data.error||('HTTP '+response.status));
  if(data.plan.repository!=='michaeljwilliams0123/Ultron.MW'||data.plan.issue?.number!==issue.number)
   throw Error('issue identity mismatch');
  selectedIssue=issue;
  currentIssuePlan=data.plan;
  renderIssuePlan(data.plan);
 }catch(error){
  selectedIssue=null;currentIssuePlan=null;
  $('issue-plan-status').textContent='Plan not confirmed: '+String(error.message||error);
  $('issue-plan-status').classList.add('error');
 }finally{$('issue-prepare').disabled=false}
}
$('issue-prepare').addEventListener('click',()=>{
 if(!selectedIssue)return status('Select an issue and verify its live plan first.',true);
 openIssuePlan(selectedIssue,'prepare');
});
$('issue-send-room').addEventListener('click',()=>{
 if(!selectedIssue||!currentIssuePlan)return status('Verify an issue before drafting a Council discussion.',true);
 const issue=selectedIssue;
 const metadata=JSON.stringify({number:issue.number,title:issue.title,
  labels:issue.labels,url:issue.url,detectedOpenBlockers:issue.blockedBy});
 const message='ULTRON_ISSUE_REMEDIATION_V1\n'+metadata+
  '\nUntrusted issue metadata only; the server must re-read GitHub before planning.';
 $('composer-body').value=message;
 $('attachment-url').value=issue.url;
 $('char-count').textContent=message.length+' / 6000';
 $('composer-body').focus();
 status('Council discussion draft only. Review and explicitly send; no GitHub write is authorized.');
});
async function refreshIssues(){
 const button=$('issue-refresh'),out=$('issue-status'),list=$('issue-list');
 selectedIssue=null;currentIssuePlan=null;$('issue-plan-panel').hidden=true;
 button.disabled=true;out.classList.remove('error');out.textContent='Reading open issues…';list.replaceChildren();
 try{
  const response=await fetch(issueApi,{method:'POST',credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw Error(issueErrors[data.error]||data.error||('HTTP '+response.status));
  const p=data.portfolio;
  out.textContent=p.count+' open issue'+(p.count===1?'':'s')+(p.truncated?' (list truncated; more exist on GitHub)':'')+' · advisory only';
  for(const i of p.issues){
   const li=node('li','issue-item '+i.status),a=node('a','','#'+i.number+' '+i.title);
   a.href=i.url;a.target='_blank';a.rel='noopener noreferrer';
   li.append(a,node('small','',i.status+(i.labels.length?' · '+i.labels.join(', '):'')),
    node('small','',i.blockedBy.length?'Blocked by open issue '+i.blockedBy.map(n=>'#'+n).join(', '):'No detected open blocker (not an execution approval)'),
    node('p','',i.nextStep));
   const plan=node('button','issue-plan','Plan with Council');
   plan.type='button';
   plan.addEventListener('click',()=>openIssuePlan(i));
   li.append(plan);
   list.append(li);
  }
 }catch(error){out.classList.add('error');out.textContent='Inventory failed: '+String(error.message||error)}
 finally{button.disabled=false}
}
$('issue-refresh').addEventListener('click',refreshIssues);
$('refresh').addEventListener('click',()=>load());
$('load-more').addEventListener('click',()=>load(state.nextCursor));
load();
try{
 const live=hatchable.events.connect({authUrl:'/api/brain/events-token'});
 const channel=live.channel('ultron.owner');
 channel.on('task',()=>load());channel.on('council-room',()=>load());channel.on('$reset',()=>load());
}catch{}
})();
