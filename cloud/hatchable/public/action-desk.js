(()=>{'use strict';
// The Council Action Desk is a client of existing owner-only effect routes.
// No browser-held credential, grant signing, implicit approvals or auto-retries.
const $=id=>document.getElementById(id);
const ENDPOINT='/api/brain/action-desk';
const state={authority:null,taskKey:null,noteKey:null,noteRequest:null,
 taskBusy:false,noteBusy:false,revision:0,lastNote:null};
const saved=key=>{try{return sessionStorage.getItem(key)}catch{return null}};
const remember=(key,value)=>{try{sessionStorage.setItem(key,value)}catch{}};
const unique=prefix=>prefix+crypto.randomUUID();
const SECRET_LIKE=/(?:password|passcode|otp|api[_ -]?key|private[_ -]?key)\s*[:=]|\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i;
state.taskKey=saved('ultron.desk.task-key');
state.noteKey=saved('ultron.desk.note-key');

function show(id,value){$(id).textContent=value}
function message(value,failed=false){
 show('desk-message',value);
 $('desk-message').dataset.state=failed?'error':'normal';
}
async function jsonFetch(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok===false)throw Error(data.error||('HTTP '+response.status));
 return data;
}
async function getReceipt(){
 const query=new URLSearchParams();
 if(state.taskKey)query.set('taskKey',state.taskKey);
 if(state.noteKey)query.set('actionKey',state.noteKey);
 return jsonFetch(ENDPOINT+(query.size?'?'+query.toString():''));
}
function renderAuthority(a){
 state.authority=a;
 show('desk-authority','Mode: '+a.preset+' · profile v'+a.profileVersion+
  ' · stop v'+a.stopVersion+' · '+(a.paused?'PAUSED':'running')+
  ' · paid ceiling: '+a.paidCeilingCents+'¢');
 $('desk-inspect').disabled=!a.inspectionAllowed||state.taskBusy;
 $('desk-note-prepare').disabled=!a.noteAllowed||state.noteBusy||!!state.noteRequest;
 $('desk-note-confirm').disabled=!a.noteAllowed||state.noteBusy;
 if(!a.inspectionAllowed||!a.noteAllowed){
  show('desk-policy','Blocked operations are not enabled from this screen. Check the owner profile, current stop state and policy.');
 }else show('desk-policy','Owner-only safe operations use existing admission rules. Consequential external writes still require their separate scoped grants.');
}
function renderTask(t){
 if(!state.taskKey){show('desk-task','No desk task submitted in this session.');return;}
 if(!t){show('desk-task','Readback pending for '+state.taskKey);return;}
 const sha=t.sourceSha?' · source '+t.sourceSha.slice(0,12):'';
 show('desk-task','Task '+(t.id||'unknown')+' · '+t.status+' · '+t.verification+
  (t.receiptId?' · receipt '+t.receiptId:'')+sha);
}
function renderNote(n){
 state.lastNote=n;
 if(!state.noteKey){show('desk-note-status','No observation submitted in this session.');return;}
 if(!n){show('desk-note-status','Receipt readback pending for '+state.noteKey);return;}
 show('desk-note-status','Observation '+(n.noteId||'unknown')+' · '+n.status+
  ' · '+n.verification+(n.receiptId?' · receipt '+n.receiptId:''));
 if(n.verification==='note-and-receipt-persisted'&&state.noteRequest){
  state.noteRequest=null;
  $('desk-note-preview').hidden=true;
  $('desk-note-confirm').hidden=true;
  $('desk-note-cancel').hidden=true;
  $('desk-note-body').value='';
 }
}
async function refresh(){
 const revision=++state.revision;
 try{
  const [snapshot,release,connections]=await Promise.all([
   getReceipt(),
   jsonFetch('/api/brain/release-proof').catch(e=>({error:e.message})),
   jsonFetch('/api/brain/connectors').catch(e=>({error:e.message}))
  ]);
  if(revision!==state.revision)return;
  renderAuthority(snapshot.authority);
  renderTask(snapshot.task);renderNote(snapshot.note);
  const proof=release.error?'unavailable ('+release.error+')':
   release.verified===true?'verified':'NOT RELEASE-VERIFIED ('+(release.status||'unverified')+')';
  show('desk-release','Release evidence: '+proof);
  const manifests=connections.providerManifests?.manifests;
  const connected=Array.isArray(manifests)?manifests.filter(x=>x.connected===true).length:null;
  const authorized=Array.isArray(manifests)?manifests.filter(x=>x.executionAuthorized===true).length:null;
  show('desk-integrations','Provider authority: '+(connected===null?'unavailable':
   connected+' connected / '+authorized+' execution-authorized')+
   '. Connection alone is not write approval.');
  show('desk-observed','Last owner readback: '+snapshot.observedAt);
  if(!state.taskBusy&&!state.noteBusy)message('Latest owner-only evidence refreshed.');
 }catch(error){
  $('desk-inspect').disabled=true;$('desk-note-prepare').disabled=true;$('desk-note-confirm').disabled=true;
  message('Evidence unavailable: '+String(error.message||error)+'. No write was attempted.',true);
 }
}
async function inspect(){
 if(state.taskBusy||!state.authority?.inspectionAllowed)return;
 // A pending or uncertain intent must be reconciled, not replaced.
 if(state.taskKey){
  const current=await getReceipt().catch(()=>null);
  if(!current){message('Previous request is unresolved. Refresh before creating another.',true);return;}
  if(current.task?.status==='queued'||current.task?.status==='leased'){
   message('The previous task is still running. Refresh to follow it.');return;
  }
  if(current.task?.verification==='reconcile-required'||current.task?.verification==='receipt-unavailable'){
   message('Prior task is uncertain. Do not submit a duplicate. Review its receipt.',true);return;
  }
 }
 state.taskBusy=true;$('desk-inspect').disabled=true;
 const key=unique('desk-');state.taskKey=key;remember('ultron.desk.task-key',key);
 message('Submitting an idempotent read-only repository inspection…');
 try{
  const created=await jsonFetch('/api/brain/tasks',{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'queue',objective:'repo.inspect',key})});
  const result=await getReceipt();
  renderTask(result.task);
  if(result.task?.id!==created.task?.id||result.task?.receiptId!==created.receipt_id)
   throw Error('queue-receipt-mismatch');
  message('Task queued with durable receipt '+created.receipt_id+'. Execution requires normal scheduler admission.');
  for(let i=0;i<6;i++){
   if(result.task?.status==='done')break;
   await new Promise(resolve=>setTimeout(resolve,1400));
   const next=await getReceipt();
   result.task=next.task;renderTask(next.task);
   if(next.task?.status==='done'||next.task?.status==='blocked')break;
  }
  if(result.task?.verification==='task-result-persisted')
   message('Repository inspection completed, with a persisted task result and owner-queue receipt. This is not release approval.');
  else message('Task is '+(result.task?.status||'unverified')+'. Refresh for authoritative readback.');
 }catch(error){
  message('Submission or readback unconfirmed: '+String(error.message||error)+
   '. The same task key is retained; refresh before retrying.',true);
 }finally{state.taskBusy=false;if(state.authority)$('desk-inspect').disabled=!state.authority.inspectionAllowed;}
}
function prepare(){
 if(!state.authority?.noteAllowed||state.noteRequest)return;
 if(state.noteKey&&state.lastNote?.verification!=='note-and-receipt-persisted')
  return message('A prior observation remains unverified. Refresh its exact-key receipt before starting another.',true);
 const body=$('desk-note-body').value.trim();
 if(!body||body.length>1200||SECRET_LIKE.test(body))
  return message('Enter a 1–1200 character non-secret observation. Tokens and passwords are not accepted.',true);
 const key=unique('desk.note:');
 state.noteRequest={key,kind:'observation',body,
  expectedProfileVersion:state.authority.profileVersion,
  expectedStopVersion:state.authority.stopVersion};
 $('desk-note-body').disabled=true;
 show('desk-note-preview','Confirm exact bounded operation: cloud.note.create · observation: '+body+
  ' · profile v'+state.noteRequest.expectedProfileVersion+
  ' · stop v'+state.noteRequest.expectedStopVersion+' · cost $0.');
 $('desk-note-preview').hidden=false;
 $('desk-note-confirm').hidden=false;$('desk-note-cancel').hidden=false;
 $('desk-note-prepare').disabled=true;
 message('Prepared only. Nothing has been written. Confirm or cancel.');
}
function cancel(){
 if(state.noteBusy)return;
 state.noteRequest=null;
 $('desk-note-preview').hidden=true;
 $('desk-note-confirm').hidden=true;$('desk-note-cancel').hidden=true;
 $('desk-note-body').disabled=false;
 $('desk-note-prepare').disabled=!state.authority?.noteAllowed;
 message('Observation preparation canceled without a write.');
}
async function confirmNote(){
 if(state.noteBusy||!state.noteRequest||!state.authority?.noteAllowed)return;
 state.noteBusy=true;$('desk-note-confirm').disabled=true;
 const request=state.noteRequest;
 state.noteKey=request.key;remember('ultron.desk.note-key',state.noteKey);
 message('Recording owner-confirmed observation with a durable exact-key receipt…');
 try{
  const result=await jsonFetch('/api/brain/cloud-action',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
  const readback=await getReceipt();
  renderNote(readback.note);
  if(readback.note?.verification!=='note-and-receipt-persisted'||
     readback.note.noteId!==result.noteId||readback.note.receiptId!==result.receiptId)
   throw Error('cloud-note-receipt-mismatch');
  message('Observation independently reread from PostgreSQL: note '+result.noteId+
   ', receipt '+result.receiptId+(result.reused?' (idempotent replay)':'')+'. No external write.');
  $('desk-note-body').disabled=false;
 }catch(error){
  message('Outcome uncertain or rejected: '+String(error.message||error)+
   '. Do not start another observation; refresh and reconcile this action key.',true);
 }finally{
  state.noteBusy=false;
  $('desk-note-confirm').disabled=!state.authority?.noteAllowed;
  if(!state.noteRequest){$('desk-note-body').disabled=false;
   $('desk-note-prepare').disabled=!state.authority?.noteAllowed;}
 }
}
$('desk-refresh').addEventListener('click',refresh);
$('desk-inspect').addEventListener('click',inspect);
$('desk-note-prepare').addEventListener('click',prepare);
$('desk-note-cancel').addEventListener('click',cancel);
$('desk-note-confirm').addEventListener('click',confirmNote);
refresh();
})();
