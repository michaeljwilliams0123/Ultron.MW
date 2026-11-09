(()=>{
'use strict';
const el=id=>document.getElementById(id);
const text=(id,s)=>{el(id).textContent=s;};
const encode=x=>btoa(String.fromCharCode(...new Uint8Array(x))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+
 '='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const newKey=()=>('owner-'+crypto.randomUUID()).slice(0,41);
let enrollment=null,prepared=null,submitted=false,processing=false;
el('enroll-key').value=newKey();
el('action-key').value=newKey();
async function json(path,body){
 const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',
  cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},
  ...(body?{body:JSON.stringify(body)}:{})});
 let x;try{x=await r.json();}catch{throw Error('unreadable-cloud-response');}
 if(!r.ok||x.ok!==true)throw Error(x.reason||x.error||'HTTP '+r.status);
 return x;
}
async function profile(){
 const r=await json('/api/brain/autonomy');
 if(r.profile?.paused||r.profile?.maxPaidCents!==0)
  throw Error('cloud-runtime-paused-or-paid-budget-changed');
 return r.profile;
}
function safe(action){
 return async()=>{
  if(processing)return;
  processing=true;
  try{await action();}
  catch(e){const id=action.stage==='enroll'?'enroll-status':'action-status';
   text(id,'Not confirmed: '+String(e?.message||e));
  }finally{processing=false;}
 };
}
async function keys(){
 const r=await json('/api/brain/owner-passkeys');
 const select=el('credential');select.replaceChildren();
 for(const c of r.credentials){
  const option=document.createElement('option');
  option.value=c.credentialId;option.textContent=c.label+' · '+c.credentialId.slice(0,12);
  select.append(option);
 }
 text('action-status',r.credentials.length+' enrolled owner passkeys found. No GitLab mutation yet.');
}
const prepareEnroll=async()=>{
 const p=await profile();
 if(!p.allowedOperations?.includes('owner.passkey.enroll'))
  throw Error('owner-enrollment-operation-not-enabled');
 const request={key:el('enroll-key').value,label:el('label').value.trim(),
  expectedProfileVersion:p.version,expectedStopVersion:p.stopVersion};
 const r=await json('/api/brain/owner-passkeys',{mode:'prepare',request});
 enrollment={key:request.key,grantRequest:r.grantRequest,challenge:r.challenge,
  userId:r.userId,rpId:r.rpId};
 el('signable').value=JSON.stringify(r.grantRequest,null,2);
 el('enroll-copy').disabled=false;el('enroll-finish').disabled=false;
 text('enroll-status','One-time owner-signed grant requested. Sign the exact JSON using your offline owner key, paste the envelope, then create your passkey.');
};
prepareEnroll.stage='enroll';
el('enroll-prepare').addEventListener('click',safe(prepareEnroll));
el('enroll-copy').addEventListener('click',safe(async()=>{
 if(!enrollment)throw Error('prepare-first');
 await navigator.clipboard.writeText(el('signable').value);
 text('enroll-status','Signing request copied. Do not paste your private key into this site.');
}));
const finishEnroll=async()=>{
 if(!enrollment)throw Error('prepare-first');
 const envelope=JSON.parse(el('envelope').value);
 if(!envelope||typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||
  Object.keys(envelope).sort().join(',')!=='payload,signature')
  throw Error('invalid-owner-envelope');
 const payload=JSON.parse(envelope.payload);
 const g=enrollment.grantRequest;
 if(payload.operation!==g.operation||payload.objectiveId!==g.objectiveId||
  payload.resource!==g.resource||payload.policySha!==g.policySha||
  payload.profileVersion!==g.profileVersion||payload.stopVersion!==g.stopVersion||
  payload.authorizedBy!=='michaeljwilliams0123')
  throw Error('signed-envelope-does-not-match-request');
 if(!window.PublicKeyCredential||!navigator.credentials?.create)
  throw Error('passkeys-unavailable-in-this-browser');
 const existing=await json('/api/brain/owner-passkeys');
 const options={challenge:decode(enrollment.challenge),
  rp:{name:'Ultron MW Cloud Brain',id:enrollment.rpId},
  user:{id:decode(enrollment.userId),name:'michaeljwilliams0123',
   displayName:'Ultron owner'},
  pubKeyCredParams:[{type:'public-key',alg:-7}],
  authenticatorSelection:{userVerification:'required',residentKey:'preferred'},
  attestation:'none',timeout:120000,
  excludeCredentials:existing.credentials.map(c=>({type:'public-key',id:decode(c.credentialId) }))};
 text('enroll-status','Confirm owner passkey creation on your device…');
 const credential=await navigator.credentials.create({publicKey:options});
 if(!credential||credential.type!=='public-key')throw Error('no-passkey-created');
 const attestation={credentialId:encode(credential.rawId),
  clientDataJSON:encode(credential.response.clientDataJSON),
  attestationObject:encode(credential.response.attestationObject)};
 const result=await json('/api/brain/owner-passkeys',{mode:'finish',key:enrollment.key,
  envelope,attestation});
 if(result.status!=='enrolled')throw Error('enrollment-not-confirmed');
 text('enroll-status','Passkey enrolled: '+result.label+'. Registration receipt persisted.');
 el('envelope').value='';el('signable').value='';enrollment=null;
 el('enroll-copy').disabled=true;el('enroll-finish').disabled=true;
 el('enroll-key').value=newKey();
 await keys();
};
finishEnroll.stage='enroll';
el('enroll-finish').addEventListener('click',safe(finishEnroll));
const prepareBranch=async()=>{
 if(submitted){throw Error('previous-submit-must-be-reconciled');}
 const p=await profile();
 if(!p.allowedOperations.includes('gitlab.branch.create'))
  throw Error('owner-profile-disallows-GitLab-branch-write');
 const sourceSha=el('source-sha').value.trim(),key=el('action-key').value;
 const credentialId=el('credential').value;
 if(!/^[a-f0-9]{40}$/.test(sourceSha)||!/^[a-z0-9-]{8,48}$/.test(key)||
  !credentialId)throw Error('source-sha-key-or-passkey-invalid');
 const request={key,sourceSha,expectedProfileVersion:p.version,
  expectedStopVersion:p.stopVersion};
 const challenge=await json('/api/brain/gitlab-passkey',
  {mode:'prepare',request,credentialId});
 prepared={request,challenge,credentialId};submitted=false;
 el('action-submit').disabled=false;
 text('action-status','Prepared '+key+' at '+sourceSha.slice(0,12)+
  '. Authorize exactly one private GitLab branch with your passkey.');
};
prepareBranch.stage='action';
el('action-prepare').addEventListener('click',safe(prepareBranch));
const submitBranch=async()=>{
 if(!prepared||submitted)throw Error('prepare-first-or-reconcile');
 if(!navigator.credentials?.get)throw Error('passkeys-unavailable-in-this-browser');
 const {request,challenge,credentialId}=prepared;
 if(!confirm('Authorize ONE GitLab branch ultron/task-'+request.key+
  ' at exact source '+request.sourceSha+'? This is a real external write.'))return;
 const assertion=await navigator.credentials.get({publicKey:{
  challenge:decode(challenge.challenge),rpId:challenge.rpId,
  allowCredentials:[{type:'public-key',id:decode(credentialId)}],
  userVerification:'required',timeout:120000
 }});
 if(!assertion||assertion.type!=='public-key')throw Error('passkey-not-confirmed');
 const proof={grantId:challenge.grantId,credentialId:encode(assertion.rawId),
  authenticatorData:encode(assertion.response.authenticatorData),
  clientDataJSON:encode(assertion.response.clientDataJSON),
  signature:encode(assertion.response.signature)};
 submitted=true;el('action-submit').disabled=true;el('action-reconcile').disabled=false;
 const result=await json('/api/brain/gitlab-passkey',{mode:'submit',request,proof});
 if(result.status!=='observed')throw Error('provider-write-not-observed');
 text('action-status','GitLab branch independently observed: '+result.branch+
  ' at '+result.evidence?.sourceSha+'. Do not resubmit this key.');
};
submitBranch.stage='action';
el('action-submit').addEventListener('click',safe(submitBranch));
const reconcile=async()=>{
 if(!prepared||!submitted)throw Error('no-previous-submit');
 const result=await json('/api/brain/gitlab-passkey',{
  mode:'reconcile',request:prepared.request,grantId:prepared.challenge.grantId});
 if(result.status!=='observed')throw Error('provider-readback-not-confirmed');
 text('action-status','Confirmed from readback: '+result.branch+' at '+
  result.evidence?.sourceSha+'. No second provider POST was sent.');
};
reconcile.stage='action';
el('action-reconcile').addEventListener('click',safe(reconcile));
el('refresh').addEventListener('click',safe(keys));
keys().then(()=>text('enroll-status','Authenticated owner registry loaded.'))
 .catch(e=>text('enroll-status','Owner authentication required: '+String(e?.message||e)));
})();
