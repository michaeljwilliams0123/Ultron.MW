// Council Room front door hand-off. Adds "Ask the Council" beside the
// Workspace composer. It carries the typed objective as a DRAFT in the URL
// fragment; the Council Room only prefills it and never sends automatically.
// On the Hatchable host it is the primary call to action, because the
// Workspace's GitHub-cloud buttons depend on routes this host does not serve.
(()=>{'use strict';
 const HOST='https://ultron-mw-cloud.hatchable.site';
 const form=document.getElementById('composer'),input=document.getElementById('message');
 if(!form||!input||document.getElementById('ask-council'))return;
 const onHatchable=location.origin===HOST;
 const target=onHatchable?'/council-room.html':HOST+'/council-room.html';
 const p=document.createElement('p');p.className='muted';p.id='ask-council-row';
 const a=document.createElement('a');a.id='ask-council';a.href=target;
 a.textContent=onHatchable?'Ask the Council (Companion replies first)':'Ask the Council instead (Companion replies first)';
 if(onHatchable)a.style.cssText='display:inline-block;background:#9ef6c7;color:#092017;border-radius:10px;padding:11px 16px;font-weight:700;text-decoration:none;margin-right:8px';
 a.addEventListener('click',()=>{
  const text=input.value.trim().slice(0,1200);
  a.href=target+(text?'#draft='+encodeURIComponent(text):'');
 });
 p.append(a,document.createTextNode(onHatchable?
  ' Start here. Owner sign-in required; your text arrives as a draft and is not sent until you press Send.':
  ' · owner sign-in required; your text arrives as a draft and is not sent until you press Send.'));
 if(onHatchable)form.insertAdjacentElement('beforebegin',p);else form.insertAdjacentElement('afterend',p);
})();
