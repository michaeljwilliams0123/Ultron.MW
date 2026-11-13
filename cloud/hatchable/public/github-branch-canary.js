(()=>{
'use strict';
const el=id=>document.getElementById(id);
const status=text=>{el('gh-status-text').textContent=text;};
const SHA=/^[a-f0-9]{40}$/,SIG=/^[A-Za-z0-9_-]{86}$/;
const MARGIN_MS=150000;
const OWNER='michaeljwilliams0123';
let ready=false,reason='not-checked',sourceSha=null,prepared=null,grantRequest=null;
let signedEnvelope=null,grantId=null,submitted=false,completed=false,submitting=false;
const disabled=(id,value)=>{el(id).disabled=value;};
function resetPrepared(){
 prepared=null;grantRequest=null;signedEnvelope=null;grantId=null;submitted=false;completed=false;
 el('gh-branch').value='';el('gh-grant').value='';el('gh-envelope').value='';
 for(const id of ['gh-copy','gh-paste','gh-submit','gh-reconcile'])disabled(id,true);
}
async function call(path,body){
 const r=await fetch(path,{
  method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
  headers:body?{'Content-Type':'application/json'}:{},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 let data;
 try{data=await r.json();}catch{throw Error('unreadable-cloud-response');}
 return {http:r.status,data,ok:r.ok&&data?.ok===true};
}
async function requireOk(path,body){
 const res=await call(path,body);
 if(!res.ok)throw Error(String(res.data?.reason||res.data?.error||'HTTP-'+res.http));
 return res.data;
}
function ciMatches(data,sha){
 return SHA.test(sha||'')&&data?.ci?.state==='observed'&&
  data.ci.conclusion==='success'&&data.ci.sourceSha===sha;
}
async function check(){
 const [auto,keys,connect]=await Promise.all([
  requireOk('/api/brain/autonomy'),
  requireOk('/api/brain/owner-passkeys'),
  requireOk('/api/brain/connectivity')
 ]);
 const p=auto.profile;
 sourceSha=connect?.github?.mainSha??null;
 el('gh-source').value=SHA.test(sourceSha||'')?sourceSha:'';
 reason=!p||p.paused||p.maxPaidCents!==0?
  'Cloud runtime is paused or paid cap differs from $0':
  !Array.isArray(keys.credentials)||keys.credentials.length===0?
  'Owner passkey not enrolled; finish Windows Hello registration first':
  !Array.isArray(p.allowedOperations)||!p.allowedOperations.includes('repair.branch.create')?
  'repair.branch.create is not enabled in the owner autonomy profile':
  !ciMatches(connect,sourceSha)?
  'Current-main CI is not observed as successful':'ready';
 ready=reason==='ready';
 disabled('gh-prepare',!ready);
 status(ready?
  'Ready to prepare one owner-signed GitHub branch at verified main '+sourceSha.slice(0,12)+'.':
  'Not ready: '+reason+'. No GitHub write sent.');
 return ready;
}
function checkEnvelope(text){
 if(!prepared||!grantRequest)throw Error('prepare-GitHub-branch-first');
 let envelope,claims;
 try{envelope=JSON.parse(text);claims=JSON.parse(envelope?.payload);}
 catch{throw Error('signed-branch-grant-invalid-json');}
 if(!envelope||typeof envelope.payload!=='string'||
  typeof envelope.signature!=='string'||!SIG.test(envelope.signature)||
  Object.keys(envelope).sort().join(',')!=='payload,signature')
  throw Error('signed-branch-grant-invalid');
 const g=grantRequest;
 if(claims.actor!==g.actor||claims.objectiveId!==g.objectiveId||
  claims.operation!==g.operation||claims.resource!==g.resource||
  claims.administrativeChange!==g.administrativeChange||
  claims.policySha!==g.policySha||claims.profileVersion!==g.profileVersion||
  claims.stopVersion!==g.stopVersion||claims.authorizedBy!==OWNER)
  throw Error('signed-branch-grant-mismatch');
 const remaining=Date.parse(claims.expiresAt)-Date.now();
 const notBefore=Date.parse(claims.notBefore);
 if(!Number.isFinite(remaining)||!Number.isFinite(notBefore))
  throw Error('signed-branch-grant-time-invalid');
 if(notBefore>Date.now()+5000)throw Error('signed-branch-grant-not-yet-valid');
 if(remaining<MARGIN_MS)throw Error('signed-branch-grant-expiry-insufficient');
 if(typeof claims.grantId!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(claims.grantId))
  throw Error('signed-branch-grant-id-invalid');
 return {envelope,grantId:claims.grantId,seconds:Math.floor(remaining/1000)};
}
async function prepare(){
 if(submitting){status('Submission in progress; do not prepare another grant.');return;}
 if(!ready){status('Not ready: '+reason+'. No GitHub write sent.');return;}
 resetPrepared();
 if(!await check())return;
 const data=await requireOk('/api/brain/github-branch-canary',
  {mode:'prepare',sourceSha});
 if(data.status!=='prepared'||!data.prepared||!data.ownerGrantRequest||
  data.prepared.sourceSha!==sourceSha||!/^ultron\/canary-hb-[a-f0-9]{24}$/.test(data.prepared.branch||''))
  throw Error('branch-preparation-response-invalid');
 prepared=data.prepared;grantRequest=data.ownerGrantRequest;
 el('gh-branch').value=prepared.branch;
 el('gh-grant').value=JSON.stringify(grantRequest,null,2);
 disabled('gh-copy',false);disabled('gh-paste',false);
 status('One exact GitHub branch prepared: '+prepared.branch+
  '. Sign the displayed request locally with your owner P-256 key; never upload that key.');
}
async function copy(){
 if(!prepared)throw Error('prepare-GitHub-branch-first');
 if(!navigator.clipboard?.writeText)throw Error('clipboard-unavailable-copy-manually');
 await navigator.clipboard.writeText(el('gh-grant').value);
 status('Exact GitHub signing request copied. Sign locally, then paste the envelope here.');
}
async function paste(){
 if(!prepared||submitted)throw Error('prepare-new-GitHub-branch-first');
 signedEnvelope=null;grantId=null;disabled('gh-submit',true);
 let raw=el('gh-envelope').value;
 if(navigator.clipboard?.readText)raw=await navigator.clipboard.readText();
 const valid=checkEnvelope(raw);
 el('gh-envelope').value=raw;
 signedEnvelope=valid.envelope;grantId=valid.grantId;
 disabled('gh-submit',false);
 status('Branch grant matched ('+valid.seconds+' seconds remain). One GitHub branch write can be authorized.');
}
async function submit(){
 if(submitted||submitting){
  status('Already submitted or in progress; use Reconcile, never re-submit this grant.');
  return;
 }
 if(!prepared||!signedEnvelope||!grantId){status('No validated owner-signed GitHub grant.');return;}
 // Claim the local one-shot latch BEFORE the first await (connectivity GET).
 // A second click must never enter this preflight or reach the write API.
 submitting=true;
 try{
  const valid=checkEnvelope(el('gh-envelope').value);
  const connectivity=await requireOk('/api/brain/connectivity');
  if(connectivity?.github?.mainSha!==prepared.sourceSha||
   !ciMatches(connectivity,prepared.sourceSha))
   throw Error('verified-main-changed-prepare-a-new-GitHub-branch');
  if(!confirm('Create exactly ONE GitHub branch '+prepared.branch+
   ' at '+prepared.sourceSha+' using this owner-signed authorization?'))return;
  submitted=true;disabled('gh-submit',true);disabled('gh-reconcile',false);
  const res=await call('/api/brain/github-branch-canary',{
   mode:'submit',prepared,envelope:valid.envelope
  });
  if(res.ok&&res.data.status==='success'){
   completed=true;
   status('GitHub branch write reported: '+String(res.data.branch)+
    '. Independently verify provider readback and PostgreSQL receipt before production acceptance.');
  }else{
   status('GitHub outcome '+String(res.data?.status||res.data?.error||'unknown')+
    '. Do not re-submit. Reconcile the existing operation with its signed grant ID.');
  }
 }finally{
  // Release the preflight lock on cancellation/stale CI, but never clear the
  // one-shot "submitted" marker after a possible remote write.
  submitting=false;
 }
}
async function reconcile(){
 if(!submitted||!prepared||!grantId){status('No previously submitted branch attempt to reconcile.');return;}
 const res=await call('/api/brain/github-branch-canary',
  {mode:'reconcile',prepared,grantId});
 if(res.ok){
  const s=res.data.status||'unavailable';
  status('Reconciled existing GitHub attempt: '+s+
   '. Verify the branch and durable PostgreSQL receipt before marking production accepted.');
  if(['reconciled_success','recovered_success','failed_before_write','abandoned'].includes(s)){
   completed=true;disabled('gh-reconcile',true);
  }
 }else status('Reconciliation '+String(res.data?.status||res.data?.error||'unavailable')+
  '. No repeat GitHub write was sent.');
}
function wire(id,fn){
 el(id).addEventListener('click',async()=>{
  try{await fn();}catch(e){status('Not confirmed: '+String(e?.message||e));}
 });
}
for(const id of ['gh-prepare','gh-copy','gh-paste','gh-submit','gh-reconcile'])disabled(id,true);
wire('gh-check',check);wire('gh-prepare',prepare);wire('gh-copy',copy);
wire('gh-paste',paste);wire('gh-submit',submit);wire('gh-reconcile',reconcile);
})();