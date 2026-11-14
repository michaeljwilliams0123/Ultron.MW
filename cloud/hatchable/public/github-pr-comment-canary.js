(()=>{
'use strict';
const byId=id=>document.getElementById(id);
const pr=byId('pull-request'),prepare=byId('prepare'),diagnose=byId('diagnose'),copy=byId('copy');
const comment=byId('comment'),signable=byId('signable'),envelope=byId('envelope');
const submit=byId('submit'),reconcile=byId('reconcile'),status=byId('status');
const controls=byId('canary-controls'),load=byId('load-target');
let prepared=null,busy=false,submitted=false,authenticated=false;
let targetVerified=false,selectedPr=null;
function setStatus(text){status.textContent=text;}
function buttons(){
 const valid=/^[1-9][0-9]{0,8}$/.test(String(pr.value||'').trim());
 const loaded=targetVerified&&selectedPr===Number(pr.value);
 pr.disabled=busy||submitted||!!prepared;
 load.disabled=busy||!authenticated||submitted||!!prepared||!valid;
 prepare.disabled=busy||submitted||!authenticated||!loaded;
 diagnose.disabled=busy||!authenticated||!valid;
 copy.disabled=busy||!prepared||submitted||!authenticated||!signable.value;
 submit.disabled=busy||!prepared||submitted||!authenticated||!loaded;
 reconcile.disabled=busy||!prepared||!submitted||!authenticated;
}
function sessionLost(){
 authenticated=false;
 if(controls)controls.style.display='none';
 buttons();setStatus('Owner authentication required. Sign in with Hatchable and return to this PR.');
 void globalThis.window?.UltronSignIn?.mount?.();
}
async function checkSession(){
 try{
  const r=await fetch('/api/brain/session',{credentials:'same-origin',cache:'no-store'});
  const data=await r.json();
  if(!r.ok||data?.authenticated!==true||data?.owner!=='michaeljwilliams0123'){
   sessionLost();return false;
  }
  authenticated=true;
  if(controls)controls.style.display='';
  buttons();return true;
 }catch{sessionLost();return false;}
}
function prNumber(){
 const pullRequest=Number(pr.value);
 if(!Number.isSafeInteger(pullRequest)||pullRequest<1||pullRequest>999999999)
  throw Error('Enter a valid pull request number.');
 return pullRequest;
}
async function hydrateStateOnLoad(){
 const pullRequest=prNumber();
 const response=await fetch('/api/brain/github-pr-comment-canary-status?pr='+pullRequest,
  {credentials:'same-origin',cache:'no-store'});
 if(response.status===401||response.status===403){sessionLost();return;}
 if(!response.ok)throw Error('Attempt status unavailable: do not start another write until previous attempts are checked.');
 const data=await response.json();
 if(['in_flight','reconcile_required'].includes(data.state)&&
    typeof data.attemptId==='string'&&data.pullRequest===pullRequest){
  prepared={pullRequest,idempotencyKey:data.attemptId,bodySha256:data.bodySha256};
  submitted=true;comment.value='';signable.value='';
  setStatus('Recovered '+data.state+' for '+data.attemptId+'. Readback only; never re-submit.');
 }else if(data.state==='reserved'){
  submitted=true;prepared={pullRequest,idempotencyKey:data.attemptId};
  setStatus('Previous attempt reserved before provider dispatch. New dispatch held; check the ledger first.');
 }else if(data.state==='completed'){
  submitted=true;prepared=null;
  setStatus('Verified persisted receipt: '+String(data.receipt?.details?.commentUrl||'completion recorded'));
 }else if(data.state==='idle'){
  prepared=null;submitted=false;
  setStatus('No pending execution for PR #'+pullRequest+'.');
 }else{throw Error('Unknown execution state; no new write permitted.');}
 buttons();
 return data;
}
async function loadTarget(){
 if(busy||!authenticated||submitted||prepared)return;
 let pullRequest;
 try{pullRequest=prNumber();}catch(error){return setStatus(String(error.message||error));}
 busy=true;targetVerified=false;selectedPr=null;buttons();
 try{
  const data=await hydrateStateOnLoad();
  if(!authenticated||!data)return;
  selectedPr=pullRequest;
  if(data.state!=='idle')return;
  const value=await call({mode:'diagnose',pullRequest});
  const probe=value?.probe||{};
  if(value.status!=='diagnosed'||probe.readOnly!==true||
     probe.repositoryHttpStatus!==200||probe.issueHttpStatus!==200||
     probe.isPullRequest!==true||probe.issueState!=='open'||
     probe.issueLocked!==false||probe.repositoryArchived!==false){
   return setStatus('Target must be a verified open, unlocked PR in the canonical non-archived repository. No write is enabled.');
  }
  targetVerified=true;
  setStatus('Verified open and unlocked PR #'+pullRequest+
   '. Execution ledger is idle; prepare is now available.');
 }catch(error){
  targetVerified=false;
  setStatus('Target verification unavailable. No new provider write is enabled: '+String(error.message||error));
 }finally{busy=false;buttons();}
}
async function call(body){
 const response=await fetch('/api/brain/github-pr-comment-canary',{
  method:'POST',credentials:'include',cache:'no-store',redirect:'error',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let value;try{value=await response.json();}catch{throw Error('Unreadable owner API response.');}
 if(response.status===401||value?.error==='login_required'||value?.error==='owner-identity-required'){
  sessionLost();throw Error('login_required');
 }
 if(value&&value.status==='disabled')
  throw Error('Canary disabled: it is inactive until the owner explicitly enables it.');
 if(value&&value.status==='not-configured')
  throw Error('Canary not configured: '+(Array.isArray(value.missing)?value.missing.join(', '):'prerequisites missing')+'.');
 // A definitively pre-dispatch 503 is a real, recoverable outcome: show it
 // without re-enabling the previously signed operation.
 if(!response.ok&&response.status!==202&&value?.dispatched!==false&&
    !(response.status===403&&value?.error==='authority-not-verified'))
  throw Error(String(value.error||('Owner API returned '+response.status)));
 return {...value,httpStatus:response.status};
}
prepare.addEventListener('click',async()=>{
 if(!authenticated||submitted||!targetVerified||selectedPr!==Number(pr.value))
  return setStatus('Load and verify a specific open PR before preparing.');
 busy=true;prepared=null;comment.value='';signable.value='';buttons();
 try{
  const pullRequest=Number(pr.value);
  if(!Number.isSafeInteger(pullRequest)||pullRequest<1)throw Error('Enter a valid pull request number.');
  const value=await call({mode:'prepare',pullRequest});
  if(value?.prepared?.pullRequest!==selectedPr)throw Error('Canary target mismatch; no grant prepared.');
  prepared=value.prepared;comment.value=prepared.commentBody;
  signable.value=JSON.stringify(value.ownerGrantRequest);
  setStatus('Prepared. Copy and sign the exact request; it expires after five minutes.');
 }catch(error){setStatus(String(error.message||error));}
 finally{busy=false;buttons();}
});
diagnose.addEventListener('click',async()=>{
 if(busy||!authenticated)return;
 busy=true;buttons();
 try{
  const pullRequest=Number(pr.value);
  if(!Number.isSafeInteger(pullRequest)||pullRequest<1)
   throw Error('Enter a valid pull request number.');
  const value=await call({mode:'diagnose',pullRequest});
  const p=value.probe||{};
  setStatus('Read-only GitHub App check: repository HTTP '+(p.repositoryHttpStatus??'unknown')+
   ', PR HTTP '+(p.issueHttpStatus??'unknown')+', state '+(p.issueState??'unknown')+
   ', locked '+String(p.issueLocked??'unknown')+
   ', archived '+String(p.repositoryArchived??'unknown')+
   '. No comment was sent. An accessible PR is not proof a comment write will succeed.');
 }catch(error){setStatus('Read-only diagnosis unavailable: '+String(error.message||error));}
 finally{busy=false;buttons();}
});
copy.addEventListener('click',async()=>{
 if(!prepared)return;
 try{await navigator.clipboard.writeText(signable.value);setStatus('Signing request copied. Keep the owner private key on the trusted device.');}
 catch{setStatus('Clipboard access failed. Select and copy the read-only signing request manually.');}
});
async function execute(mode){
 if(!authenticated||!prepared)return;
 if(mode==='submit'&&submitted)return setStatus('Operation already attempted; use readback.');
 if(mode==='reconcile'&&!submitted)return;
 let signed;
 if(mode==='submit'){
  try{signed=JSON.parse(envelope.value);}catch{return setStatus('Paste a valid signed JSON envelope first.');}
  if(!signed||typeof signed.payload!=='string'||typeof signed.signature!=='string')
   return setStatus('The signed envelope must contain payload and signature.');
 }
 if(mode==='submit')submitted=true;
 busy=true;buttons();
 try{
  const value=mode==='reconcile'
   ?await call({mode:'readback',pullRequest:prepared.pullRequest,idempotencyKey:prepared.idempotencyKey})
   :await call({mode:'submit',prepared,envelope:signed});
  if(value.ok&&value.receipt?.details?.commentUrl){
   setStatus('Verified '+value.status+': '+value.receipt.details.commentUrl);
   envelope.value='';prepared=null;submitted=false;
  }else if(mode==='submit'&&value.httpStatus===403&&value.error==='authority-not-verified'){
   submitted=false;
   setStatus('Definitive authorization rejection (403): invalid signature before reservation. Sign a fresh grant; no provider write occurred.');
  }else{
   const stage=value.stage?' · stage: '+value.stage:'';
   const reason=value.reason||value.error||'Readback required';
   setStatus((value.status||'held')+': '+reason+stage+'. Do not resubmit this operation; use readback only.');
  }
 }catch(error){
  setStatus(String(error.message||error)+
   ' The outcome may be unknown. Do not resubmit; use readback only.');
 }
 finally{busy=false;buttons();}
}
submit.addEventListener('click',()=>execute('submit'));
reconcile.addEventListener('click',()=>execute('reconcile'));
const initialPr=new URLSearchParams(globalThis.location?.search||'').get('pr');
if(initialPr&&/^[1-9][0-9]{0,8}$/.test(initialPr))pr.value=initialPr;
pr.addEventListener('change',()=>{
 if(submitted||prepared){
  pr.value=selectedPr===null?'':String(selectedPr);
  return setStatus('A prepared or pending operation is pinned to its original PR. Complete readback before changing targets.');
 }
 targetVerified=false;selectedPr=null;
 comment.value='';signable.value='';envelope.value='';
 setStatus('Click Load target to inspect the selected PR before preparing.');
 buttons();
});
load.addEventListener('click',()=>loadTarget());
buttons();
void checkSession().then(async ok=>{
 if(!ok)return;
 if(pr.value)await loadTarget();
 else{setStatus('Enter an open PR number, then click Load target. No execution is enabled.');buttons();}
});
})();
