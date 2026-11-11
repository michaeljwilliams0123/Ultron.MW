// Navigation guard: a nav link to a page that this deployment does not serve
// (HTTP 404) is shown as "not deployed" instead of leading to a dead end.
// Read-only HEAD requests to this origin; nothing else is sent anywhere.
(()=>{'use strict';
 const links=[...document.querySelectorAll('nav a[href]')].filter(a=>{
  try{const u=new URL(a.getAttribute('href'),location.href);
   return u.origin===location.origin&&/\.html$/.test(u.pathname)&&u.pathname!==location.pathname}catch{return false}
 });
 const seen=new Map();
 for(const a of links){
  const path=new URL(a.getAttribute('href'),location.href).pathname;
  if(!seen.has(path))seen.set(path,fetch(path,{method:'HEAD',credentials:'same-origin',cache:'no-store'})
   .then(r=>r.status).catch(()=>0));
  seen.get(path).then(status=>{
   if(status!==404)return;
   a.removeAttribute('href');
   a.setAttribute('aria-disabled','true');
   a.title='This page is in source but not deployed to this Hatchable site yet.';
   a.textContent=a.textContent+' (not deployed)';
   a.style.opacity='.55';a.style.cursor='not-allowed';
  });
 }
})();
