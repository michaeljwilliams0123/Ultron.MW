// Shared owner sign-in for every Hatchable page.
// - safeLoginUrl: accepts only an https://*.hatchable.com login_url from the
//   API's login_required response and points its callback's `next` at the
//   current page, so sign-in returns where the owner started.
// - A [data-sign-in-card] element becomes a sign-in card when the owner
//   session is missing (401) or belongs to someone else (403).
// Read-only: one GET to /api/brain/session. Nothing is stored.
(()=>{'use strict';
 function safeLoginUrl(raw){
  try{
   const url=new URL(String(raw||''));
   if(url.protocol!=='https:'||!/(^|\.)hatchable\.com$/.test(url.hostname))return null;
   const back=url.searchParams.get('redirect');
   if(back){
    const inner=new URL(back);
    if(inner.origin===location.origin){inner.searchParams.set('next',location.pathname);url.searchParams.set('redirect',inner.href)}
   }
   return url.href;
  }catch{return null}
 }
 const FALLBACK='https://hatchable.com/console/projects/ultron-mw-cloud';
 function card(slot,{state,href}){
  slot.replaceChildren();
  const box=document.createElement('section');
  box.setAttribute('role','region');box.setAttribute('aria-label','Owner sign-in');
  box.style.cssText='max-width:940px;margin:14px auto;padding:16px;border:1px solid #4c9b77;border-radius:12px;background:#10241e;color:#edf8f3;font:14px/1.5 system-ui,sans-serif';
  const h=document.createElement('strong');
  h.textContent=state==='not-owner'?'Signed in, but not as the owner':'Sign in to use owner controls';
  const p=document.createElement('p');p.style.margin='6px 0 12px';
  p.textContent=state==='not-owner'?'These controls only open for michaeljwilliams0123. Sign in with that account.':
   'Owner-only. Sign in with Hatchable and you will come back to this page.';
  const a=document.createElement('a');a.href=href||FALLBACK;a.rel='noopener';
  a.textContent='Sign in with Hatchable';
  a.style.cssText='display:inline-block;background:#9ef6c7;color:#092017;border-radius:9px;padding:9px 14px;font-weight:700;text-decoration:none';
  box.append(h,p,a);slot.append(box);
 }
 async function mount(){
  const slots=[...document.querySelectorAll('[data-sign-in-card]')];
  if(!slots.length)return;
  try{
   const r=await fetch('/api/brain/session',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
   if(r.status!==401&&r.status!==403)return slots.forEach(s=>s.replaceChildren());
   const data=await r.json().catch(()=>({}));
   const state=r.status===403&&data.error!=='login_required'?'not-owner':'guest';
   for(const s of slots)card(s,{state,href:safeLoginUrl(data.login_url)});
  }catch{}
 }
 window.UltronSignIn=Object.freeze({safeLoginUrl,mount});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
