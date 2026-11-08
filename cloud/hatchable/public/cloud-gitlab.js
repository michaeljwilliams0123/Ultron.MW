(()=>{
'use strict';
const get=id=>document.getElementById(id);
const key=get('cloud-gitlab-key'),sha=get('cloud-gitlab-sha');
const prepareButton=get('cloud-gitlab-prepare'),copyButton=get('cloud-gitlab-copy');
const submitButton=get('cloud-gitlab-submit'),reconcileButton=get('cloud-gitlab-reconcile');
const grantBox=get('cloud-gitlab-grant'),envelopeBox=get('cloud-gitlab-envelope');
const status=get('cloud-gitlab-status');
const EXACT_SHA=/^[a-f0-9]{40}$/,KEY=/^[a-z0-9-]{8,48}$/;
let prepared=null,signable=null,grantId=null,submitted=false,busy=false,revision=0;
const report=message=>{status.textContent=message;};
function controls(){
 key.disabled=busy||submitted;
 sha.disabled=busy||submitted;
 prepareButton.disabled=busy||submitted;
 copyButton.disabled=busy||!signable;
 submitButton.disabled=busy||submitted||!signable||!envelopeBox.value.trim();
 reconcileButton.disabled=busy||!grantId||!prepared;
}
function reset(){
 revision++;
 if(submitted){
  // Once a POST was attempted, preserve the original grant and target until
  // a readback is complete. Editing inputs must not unlock another submit.
  key.value=prepared?.key??key.value;
  sha.value=prepared?.sourceSha??sha.value;
  controls();
  report('Write already attempted. Reconcile the original grant; do not submit again.');
  return;
 }
 prepared=null;signable=null;grantId=null;
 grantBox.value='';envelopeBox.value='';controls();
 report('Input changed. Prepare a fresh owner-signed request before submitting.');
}
async function request(method,path,body){
 const result=await fetch(path,{method,credentials:'same-origin',cache:'no-store',
  headers:body?{'Content-Type':'application/json'}:{},
  ...(body?{body:JSON.stringify(body)}:{})});
 let value;try{value=await result.json();}catch{throw Error('unreadable-response');}
 if(!result.ok||value.ok===false)
  throw Object.assign(Error(value.reason||value.error||'server-rejected'),{code:result.status,reply:value});
 return value;
}
async function lock(fn){
 if(busy)return;
 busy=true;controls();
 try{await fn();}catch(err){
  report('No success assumed: '+String(err?.message||'request-failed')+
   '. If a submit was attempted, only reconcile the existing grant.');
 }finally{busy=false;controls();}
}
function signedEnvelope(){
 const env=JSON.parse(envelopeBox.value.trim());
 if(!env||typeof env.payload!=='string'||typeof env.signature!=='string'||
  Object.keys(env).sort().join(',')!=='payload,signature')
  throw Error('invalid-envelope-fields');
 const payload=JSON.parse(env.payload);
 if(!prepared||!signable||payload.operation!==signable.operation||
    payload.objectiveId!==signable.objectiveId||
    payload.resource!==signable.resource||
    payload.policySha!==signable.policySha||
    payload.actor!==signable.actor||
    payload.administrativeChange!==signable.administrativeChange||
    payload.profileVersion!==signable.profileVersion||
    payload.stopVersion!==signable.stopVersion||
    payload.authorizedBy!=='michaeljwilliams0123'||
    typeof payload.grantId!=='string')
   throw Error('signed-grant-does-not-match-preparation');
 return {env,id:payload.grantId};
}
prepareButton.addEventListener('click',()=>lock(async()=>{
 const inputKey=key.value,inputSha=sha.value,generation=revision;
 if(!KEY.test(inputKey)||!EXACT_SHA.test(inputSha)){
  throw Error('invalid-idempotency-key-or-commit-sha');
 }
 const owner=await request('GET','/api/brain/autonomy');
 if(generation!==revision||key.value!==inputKey||sha.value!==inputSha)return;
 const p=owner.profile;
 if(p?.owner!=='michaeljwilliams0123'||p.paused||
    p.maxPaidCents!==0||!p.allowedOperations?.includes('gitlab.branch.create'))
  throw Error('owner-profile-or-stop-denied');
 const req={key:inputKey,sourceSha:inputSha,
  expectedProfileVersion:p.version,expectedStopVersion:p.stopVersion};
 const value=await request('POST','/api/brain/gitlab-branch',{mode:'prepare',request:req});
 if(generation!==revision||key.value!==inputKey||sha.value!==inputSha)return;
 if(value.mode!=='prepare'||value.grantRequest?.operation!=='gitlab.branch.create'||
    value.grantRequest.objectiveId!==inputKey||
    value.grantRequest.profileVersion!==p.version||
    value.grantRequest.stopVersion!==p.stopVersion||
    !/^[a-f0-9]{64}$/.test(value.grantRequest.policySha))
  throw Error('unverified-preparation');
 prepared=req;submitted=false;grantId=null;
 signable={...value.grantRequest};
 grantBox.value=JSON.stringify(signable,null,2);
 envelopeBox.value='';
 report('Owner profile v'+p.version+' / stop v'+p.stopVersion+
  ' confirmed. Sign the request on your owner-controlled device, then paste the envelope.');
}));
copyButton.addEventListener('click',()=>lock(async()=>{
 if(!signable)throw Error('prepare-first');
 await navigator.clipboard.writeText(JSON.stringify(signable,null,2));
 report('Signable request copied. Never copy the private signing key into this page.');
}));
submitButton.addEventListener('click',()=>lock(async()=>{
 if(!prepared||submitted)throw Error('prepare-first-or-reconcile-existing');
 const {env,id}=signedEnvelope();
 if(!window.confirm('Submit ONE branch creation to private GitLab project 87884831? The same key will never be POSTed twice.'))return;
 submitted=true;grantId=id;
 // A request may have reached GitLab even if HTTP response is lost.
 // Never clear submitted after failure. Reconcile on a separate read-only path.
 const value=await request('POST','/api/brain/gitlab-branch',
  {mode:'submit',request:prepared,envelope:env});
 if(value.status!=='observed')throw Error(value.reason||'write-outcome-uncertain');
 report('Observed real GitLab branch '+value.branch+' at '+value.evidence?.sourceSha+
  '. Use provider readback to confirm ledger evidence. No duplicate POST.');
}));
reconcileButton.addEventListener('click',()=>lock(async()=>{
 if(!prepared||!grantId)throw Error('no-previous-grant');
 const result=await request('POST','/api/brain/gitlab-branch',
  {mode:'reconcile',request:prepared,grantId});
 if(result.status!=='observed')throw Error(result.reason||'receipt-not-yet-observed');
 report('Readback observed for '+result.branch+' at '+result.evidence?.sourceSha+
  '. No new GitLab POST was made.');
}));
for(const input of [key,sha])input.addEventListener('input',reset);
envelopeBox.addEventListener('input',controls);
controls();
})();
