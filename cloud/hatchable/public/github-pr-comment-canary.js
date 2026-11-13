(()=>{
'use strict';
const byId=id=>document.getElementById(id);
const pr=byId('pull-request'),prepare=byId('prepare'),diagnose=byId('diagnose'),copy=byId('copy');
const comment=byId('comment'),signable=byId('signable'),envelope=byId('envelope');
const submit=byId('submit'),reconcile=byId('reconcile'),status=byId('status');
let prepared=null,busy=false,submitted=false;
function setStatus(text){status.textContent=text;}
function buttons(){
 prepare.disabled=busy||submitted;diagnose.disabled=busy;copy.disabled=busy||!prepared;
 submit.disabled=busy||!prepared||submitted;
 reconcile.disabled=busy||!prepared||!submitted;
}
async function call(body){
 const response=await fetch('/api/brain/github-pr-comment-canary',{
  method:'POST',credentials:'include',cache:'no-store',redirect:'error',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let value;try{value=await response.json();}catch{throw Error('Unreadable owner API response.');}
 if(value&&value.status==='disabled')
  throw Error('Canary disabled: it is inactive until the owner explicitly enables it.');
 if(value&&value.status==='not-configured')
  throw Error('Canary not configured: '+(Array.isArray(value.missing)?value.missing.join(', '):'prerequisites missing')+'.');
 // A definitively pre-dispatch 503 is a real, recoverable outcome: show it
 // without re-enabling the previously signed operation.
 if(!response.ok&&response.status!==202&&value?.dispatched!==false)
  throw Error(String(value.error||`Owner API returned ${response.status}.`));
 return value;
}
prepare.addEventListener('click',async()=>{
 if(submitted)return setStatus('An earlier operation is unresolved. Use readback; do not prepare another until its outcome is known.');
 busy=true;prepared=null;comment.value='';signable.value='';buttons();
 try{
  const pullRequest=Number(pr.value);
  if(!Number.isSafeInteger(pullRequest)||pullRequest<1)throw Error('Enter a valid pull request number.');
  const value=await call({mode:'prepare',pullRequest});
  prepared=value.prepared;comment.value=prepared.commentBody;
  signable.value=JSON.stringify(value.ownerGrantRequest);
  setStatus('Prepared. Copy and sign the exact request; it expires after five minutes.');
 }catch(error){setStatus(String(error.message||error));}
 finally{busy=false;buttons();}
});
diagnose.addEventListener('click',async()=>{
 if(busy)return;
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
 if(!prepared)return;
 if(mode==='submit'&&submitted)
  return setStatus('The external write was already attempted. Reconcile it; do not resubmit.');
 if(mode==='reconcile'&&!submitted)return;
 let signed;try{signed=JSON.parse(envelope.value);}catch{return setStatus('Paste a valid JSON envelope first.');}
 // Fail closed even if the request times out or the response is unreadable.
 if(mode==='submit')submitted=true;
 busy=true;buttons();
 try{
  const value=await call({mode,prepared,envelope:signed});
  if(value.ok&&value.receipt?.details?.commentUrl){
   setStatus(`Verified ${value.status}: ${value.receipt.details.commentUrl}`);
   envelope.value='';prepared=null;submitted=false;
  }else{
   const stage=value.stage?' · stage: '+value.stage:'';
   const reason=value.reason||value.error||'Readback is still required.';
   setStatus(`${value.status||'held'}: ${reason}${stage}. Do not resubmit this operation; use readback only.`);
  }
 }catch(error){
  setStatus(String(error.message||error)+
   ' The provider outcome may be unknown. Do not resubmit; use readback only.');
 }
 finally{busy=false;buttons();}
}
submit.addEventListener('click',()=>execute('submit'));
reconcile.addEventListener('click',()=>execute('reconcile'));
buttons();
})();
