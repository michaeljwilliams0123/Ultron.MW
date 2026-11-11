(()=>{
'use strict';
const byId=id=>document.getElementById(id);
const pr=byId('pull-request'),prepare=byId('prepare'),copy=byId('copy');
const comment=byId('comment'),signable=byId('signable'),envelope=byId('envelope');
const submit=byId('submit'),reconcile=byId('reconcile'),status=byId('status');
let prepared=null,busy=false;
function setStatus(text){status.textContent=text;}
function buttons(){
 prepare.disabled=busy;copy.disabled=busy||!prepared;
 submit.disabled=busy||!prepared;reconcile.disabled=busy||!prepared;
}
async function call(body){
 const response=await fetch('/api/brain/github-pr-comment-canary',{
  method:'POST',credentials:'include',cache:'no-store',redirect:'error',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let value;try{value=await response.json();}catch{throw Error('Unreadable owner API response.');}
 if(value&&value.status==='not-configured')
  throw Error('Canary not configured: '+(Array.isArray(value.missing)?value.missing.join(', '):'prerequisites missing')+'.');
 if(!response.ok&&response.status!==202)
  throw Error(String(value.error||`Owner API returned ${response.status}.`));
 return value;
}
prepare.addEventListener('click',async()=>{
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
copy.addEventListener('click',async()=>{
 if(!prepared)return;
 try{await navigator.clipboard.writeText(signable.value);setStatus('Signing request copied. Keep the owner private key on the trusted device.');}
 catch{setStatus('Clipboard access failed. Select and copy the read-only signing request manually.');}
});
async function execute(mode){
 if(!prepared)return;
 let signed;try{signed=JSON.parse(envelope.value);}catch{return setStatus('Paste a valid JSON envelope first.');}
 busy=true;buttons();
 try{
  const value=await call({mode,prepared,envelope:signed});
  if(value.ok)envelope.value='';
  if(value.ok&&value.receipt?.details?.commentUrl)
   setStatus(`Verified ${value.status}: ${value.receipt.details.commentUrl}`);
  else setStatus(`${value.status||'held'}: ${value.error||'Readback is still required.'}`);
 }catch(error){setStatus(String(error.message||error));}
 finally{busy=false;buttons();}
}
submit.addEventListener('click',()=>execute('submit'));
reconcile.addEventListener('click',()=>execute('reconcile'));
buttons();
})();
