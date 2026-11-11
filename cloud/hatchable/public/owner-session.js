(()=>{
'use strict';
const OWNER='michaeljwilliams0123';
const link=document.getElementById('owner-session-link');
const indicator=document.getElementById('owner-session-status');
if(!link||!indicator)return;
let inflight=false;
// Build the sign-in href from the API's login_url (allowlisted, returns to
// this page) when the shared helper is loaded; otherwise keep the default.
function useLoginUrl(raw){
 const safe=window.UltronSignIn&&window.UltronSignIn.safeLoginUrl;
 const href=typeof safe==='function'?safe(raw):null;
 if(href){link.href=href;link.removeAttribute('target');}
}
function report(state,message){
 window.ultronOwnerSessionState=state;
 link.hidden=state!=='guest'&&state!=='not-owner';
 indicator.textContent=message;
 window.dispatchEvent(new CustomEvent('ultron:owner-session-state',
  {detail:{state}}));
}
async function check(){
 if(inflight)return;
 inflight=true;
 try{
  const r=await fetch('/api/brain/session',{method:'GET',
   credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  if(r.status===401||r.status===403){
   let data={};
   try{data=await r.json()||{}}catch{}
   useLoginUrl(data.login_url);
   // 403 from an authenticated non-owner is not the same as signed out.
   if(r.status===403&&data.error!=='login_required'){
    report('not-owner','Signed in, but not as the owner · switch accounts');return;
   }
   report('guest','Owner sign-in required');return;
  }
  if(!r.ok){
   report('unknown','Owner session unavailable · retry on return');return;
  }
  const data=await r.json();
  if(data?.schema!=='ultron.owner-session.v1'||
     data?.authenticated!==true||data?.owner!==OWNER){
   report('unknown','Owner identity could not be verified');return;
  }
  report('authenticated','Owner authenticated · private actions available');
 }catch{
  report('unknown','Owner session unavailable · retry on return');
 }finally{inflight=false;}
}
window.addEventListener('focus',()=>{void check()});
window.addEventListener('pageshow',()=>{void check()});
void check();
})();
