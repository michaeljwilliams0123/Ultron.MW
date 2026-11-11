// Council Room front door hand-off. Adds an "Ask the Council" link beside the
// Workspace composer. It carries the typed objective as a DRAFT in the URL
// fragment; the Council Room only prefills it and never sends automatically.
(()=>{'use strict';
 const ROOM='https://ultron-mw-cloud.hatchable.site/council-room.html';
 const form=document.getElementById('composer'),input=document.getElementById('message');
 if(!form||!input||document.getElementById('ask-council'))return;
 const target=location.origin==='https://ultron-mw-cloud.hatchable.site'?'/council-room.html':ROOM;
 const p=document.createElement('p');p.className='muted';p.id='ask-council-row';
 const a=document.createElement('a');a.id='ask-council';a.href=target;
 a.textContent='Ask the Council instead (Companion replies first)';
 a.addEventListener('click',()=>{
  const text=input.value.trim().slice(0,1200);
  a.href=target+(text?'#draft='+encodeURIComponent(text):'');
 });
 p.append(a,document.createTextNode(' · owner sign-in required; your text arrives as a draft and is not sent until you press Send.'));
 form.insertAdjacentElement('afterend',p);
})();
