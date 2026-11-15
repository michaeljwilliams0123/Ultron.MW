(()=>{
'use strict';
const el=id=>document.getElementById(id);
const session=el('session-state'),prStatus=el('pr-state');
const link=el('canary-link'),device=el('device-state'),cloudflare=el('cloudflare-state');
const query=new URLSearchParams(location.search||'');
const selected=query.get('pr');
const target=selected&&/^[1-9][0-9]{0,8}$/.test(selected)?selected:null;
if(target){
 link.href='./github-pr-comment-canary.html?pr='+target;
 prStatus.textContent='PR #'+target+': owner sign-in required before checking the ledger.';
}else{
 prStatus.textContent='No PR selected. Choose an open PR in the C04 cloud console.';
}
if(typeof window.PublicKeyCredential==='function'){
 device.textContent='This browser exposes passkey support. A prompt still requires a credential saved on or available to your device.';
}else{
 device.textContent='Passkey availability could not be confirmed in this browser. Open the page in Safari and check Apple Passwords.';
}
async function checkCloudflare(){
 if(!cloudflare)return;
 try{
  const response=await fetch('/api/brain/cloudflare-edge-health',{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json'}
  });
  if(response.status===401||response.status===403){
   cloudflare.textContent='Owner authorization required to read Cloudflare status.';
   return;
  }
  const data=await response.json().catch(()=>({}));
  if(response.ok&&data.schema==='ultron.cloudflare-edge-health.v1'&&
     data.state==='observed'&&data.executionAuthorized===false){
   cloudflare.textContent=data.ingressAccepting===true
    ?'Cloudflare staging edge is accepting signed events. This does not approve a GitHub write.'
    :'Cloudflare staging Worker online. Signed ingress is disabled until the receiving system is fully verified.';
  }else{
   cloudflare.textContent='Cloudflare live health unavailable or invalid. Staging execution remains unverified.';
  }
 }catch{
  cloudflare.textContent='Cloudflare health could not be checked. No task was dispatched.';
 }
}
async function init(){
 try{
  const response=await fetch('/api/brain/session',{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json'}
  });
  const data=await response.json();
  if(response.status===401||data?.error==='login_required'){
   session.textContent='Sign in with Hatchable using the owner account. Use the sign-in card above.';
   await window.UltronSignIn?.mount?.();
   return;
  }
  if(!response.ok||data?.authenticated!==true||data?.owner!=='michaeljwilliams0123'){
   session.textContent='Owner account not verified. Switch to the Hatchable owner account.';
   await window.UltronSignIn?.mount?.();
   return;
  }
  session.textContent='Owner session verified. You can inspect cloud readiness from this iPhone.';
  await checkCloudflare();
  if(!target)return;
  try{
   const r=await fetch('/api/brain/github-pr-comment-canary-status?pr='+target,{
    method:'GET',credentials:'same-origin',cache:'no-store',
    headers:{Accept:'application/json'}
   });
   if(r.status===401||r.status===403){
    prStatus.textContent='Owner authorization expired. Sign in again; no GitHub write was attempted.';
    await window.UltronSignIn?.mount?.();
    return;
   }
   if(!r.ok){
    prStatus.textContent='PR #'+target+': status unavailable. Do not prepare another write until the ledger is checked.';
    return;
   }
   const result=await r.json();
   if(result.pullRequest!==Number(target)){
    prStatus.textContent='PR status target mismatch. No operation is enabled.';
    return;
   }
   if(result.state==='idle')
    prStatus.textContent='PR #'+target+': cloud ledger idle. Open the C04 console to verify the PR is still open.';
   else if(result.state==='completed')
    prStatus.textContent='PR #'+target+': completed receipt recorded. Review it in the C04 console.';
   else if(['reserved','in_flight','reconcile_required'].includes(result.state))
    prStatus.textContent='PR #'+target+': '+result.state+'. Readback/reconcile only—never duplicate a write.';
   else
    prStatus.textContent='PR #'+target+': unknown status. No new operation is enabled.';
  }catch{
   prStatus.textContent='PR status request failed. Do not initiate another write until the ledger can be read.';
  }
 }catch{
  session.textContent='Could not check the Hatchable owner session. Open Safari and try again.';
 }
}
void init();
})();
