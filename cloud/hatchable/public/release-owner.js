(()=>{
'use strict';
const $=id=>document.getElementById(id),status=s=>{$('status').textContent=s};
const endpoint='/api/brain/release-passkey';
let prepared=null,attempted=null,busy=false;
const fields=['target','sha','digest','count','credential'];
function update(){for(const id of fields)$(id).disabled=busy||!!attempted;
 $('load').disabled=busy||!!attempted;$('prepare').disabled=busy||!!attempted||!$('credential').value;
 $('authorize').disabled=busy||!prepared||!!attempted;$('reconcile').disabled=busy||!attempted;$('verify').disabled=busy;}
const act=fn=>async()=>{if(busy)return;busy=true;update();try{await fn()}catch(e){status(String(e?.message||'Request unavailable'));}finally{busy=false;update()}};
async function json(path,body){
 const r=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
 headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
 ...(body===undefined?{}:{body:JSON.stringify(body)})});
 let data;try{data=await r.json()}catch{throw Error('Response unavailable; check owner sign-in.')}
 if(!r.ok)throw Error(data?.reason||('HTTP '+r.status));return data;
}
const decode=v=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-v.length%4)%4)),x=>x.charCodeAt(0));
const encode=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function input(){
 const target=$('target').value.trim(),sourceSha=$('sha').value.trim(),artifactDigest=$('digest').value.trim(),manifestFileCount=Number($('count').value);
 if(!/^hatchable-v[1-9][0-9]{0,8}$/.test(target)||!/^[a-f0-9]{40}$/.test(sourceSha)||!/^sha256:[a-f0-9]{64}$/.test(artifactDigest)||!Number.isSafeInteger(manifestFileCount)||manifestFileCount<1||manifestFileCount>5000)throw Error('Enter the exact version, source, digest and file count.');
 return {key:'deploy-'+target.slice(10)+'-main',target,sourceSha,artifactDigest,manifestFileCount,independentReadback:true};
}
async function refreshProof(expected=null){
 const p=await json('/api/brain/release-proof');
 const exact=!expected||(p.commitSha===expected.sourceSha&&p.deployment?.target===expected.target&&p.deployment?.artifactDigest===expected.artifactDigest);
 const confirmed=p.verified===true&&exact;
 status(JSON.stringify({verified:confirmed,reportedVerified:p.verified===true,exactRelease:exact,sourceSha:p.commitSha,target:p.deployment?.target,receiptId:p.deployment?.receiptId,missingGates:p.driftDetails?.missingGates},null,2));
 return confirmed;
}
async function reconcile(){
 if(!attempted)throw Error('No prior submission to reconcile.');
 const {request,grantId}=attempted;
 const receipt=await json(endpoint,{mode:'reconcile',request,grantId});
 if(!receipt.ok||receipt.status!=='observed'||receipt.grantId!==grantId||receipt.target!==request.target||receipt.sourceSha!==request.sourceSha||receipt.artifactDigest!==request.artifactDigest||receipt.manifestFileCount!==request.manifestFileCount)throw Error('Receipt not independently observed; no resubmission was sent.');
 await refreshProof(request);
}
async function keys(){
 const r=await json('/api/brain/owner-passkeys');
 $('credential').replaceChildren();
 for(const c of r.credentials||[]){const o=document.createElement('option');o.value=c.credentialId;o.textContent=c.label;$('credential').append(o);}
 status($('credential').value?'Owner passkey registry loaded.':'No enrolled passkey; use the existing enrollment page.');
}
for(const id of fields)$(id).addEventListener('input',()=>{prepared=null;$('details').textContent='';update()});
$('load').addEventListener('click',act(keys));
$('prepare').addEventListener('click',act(async()=>{
 prepared=null;
 const request=input(),credentialId=$('credential').value;
 const challenge=await json(endpoint,{mode:'prepare',request,credentialId});
 if(!challenge.ok||challenge.status!=='prepared'||challenge.credentialId!==credentialId||challenge.rpId!==location.hostname)throw Error('Challenge unavailable.');
 prepared={request,credentialId,challenge};
 $('details').textContent=JSON.stringify({target:request.target,sourceSha:request.sourceSha,artifactDigest:request.artifactDigest,manifestFileCount:request.manifestFileCount,expiresAt:challenge.expiresAt},null,2);
 status('Live manifest verified. Review the exact release, then approve on your device.');
}));
$('authorize').addEventListener('click',act(async()=>{
 if(!prepared||attempted||!navigator.credentials?.get)throw Error('Prepare a release on a passkey-capable device.');
 const {request,challenge,credentialId}=prepared;
 if(Date.parse(challenge.expiresAt)-Date.now()<30000)throw Error('Challenge expired or near expiry; check the release again.');
 if(!confirm('Record ONE receipt for '+request.target+' at '+request.sourceSha+'?'))return;
 const assertion=await navigator.credentials.get({publicKey:{challenge:decode(challenge.challenge),rpId:challenge.rpId,
 allowCredentials:[{type:'public-key',id:decode(credentialId)}],userVerification:'required',timeout:120000}});
 if(!assertion||assertion.type!=='public-key')throw Error('Passkey not confirmed.');
 const proof={grantId:challenge.grantId,credentialId:encode(assertion.rawId),
 authenticatorData:encode(assertion.response.authenticatorData),clientDataJSON:encode(assertion.response.clientDataJSON),signature:encode(assertion.response.signature)};
 attempted={request,grantId:challenge.grantId};prepared=null;update();
 try{await json(endpoint,{mode:'submit',request,proof})}catch{}
 await reconcile(); // Never repeat a mutating submission after an ambiguous response.
}));
$('reconcile').addEventListener('click',act(reconcile));
$('verify').addEventListener('click',act(()=>refreshProof(attempted?.request)));
update();void act(keys)();
})();
