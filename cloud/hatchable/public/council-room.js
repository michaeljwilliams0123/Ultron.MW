(()=>{'use strict';
const api='/api/brain/council-room';
const state={members:[],messages:[],jobs:[],nextCursor:null,sending:false};
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
function renderMessages(){
 const list=$('message-list');list.replaceChildren();
 if(!state.messages.length){
  const empty=node('li','empty','No room messages yet. Start with a question or objective for the council.');
  list.append(empty);return;
 }
 for(const m of state.messages){
  const li=node('li','message '+(m.authorType==='owner'?'owner':m.authorType));
  const avatar=node('div','message-avatar',roleInitials[m.authorId]||String(m.authorRole||m.authorId).slice(0,2).toUpperCase());
  const bubble=node('article','bubble');const meta=node('div','message-meta');
  const author=m.authorType==='member'?(m.authorRole||m.authorId):(names[m.authorType]||m.authorId);
  meta.append(node('strong','',author),node('span','kind',m.kind||'message'));
  const time=document.createElement('time');time.dateTime=m.createdAt;time.textContent=timeLabel(m.createdAt);meta.append(time);
  bubble.append(meta,node('p','',m.body));
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
async function load(before=null){
 try{
  const url=new URL(api,location.origin);url.searchParams.set('limit','60');if(before)url.searchParams.set('before',before);
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok)throw Error(data.error||('HTTP '+response.status));
  state.members=data.members||[];state.jobs=data.jobs||[];state.nextCursor=data.nextCursor;
  state.messages=before?[...(data.messages||[]),...state.messages]:(data.messages||[]);
  renderMembers();renderMessages();renderJobs();
  $('load-more').hidden=!state.nextCursor;
  status('Live room connected · '+state.messages.length+' entries · paid spend ceiling $0');
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
$('send').addEventListener('click',send);
$('composer-body').addEventListener('input',e=>$('char-count').textContent=e.target.value.length+' / 6000');
$('composer-body').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();send()}});
$('refresh').addEventListener('click',()=>load());
$('load-more').addEventListener('click',()=>load(state.nextCursor));
load();
try{
 const live=hatchable.events.connect({authUrl:'/api/brain/events-token'});
 const channel=live.channel('ultron.owner');
 channel.on('task',()=>load());channel.on('council-room',()=>load());channel.on('$reset',()=>load());
}catch{}
})();