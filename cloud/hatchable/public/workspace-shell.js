(()=>{'use strict';
 const modules=[
  ['/council-room.html','Council','Conversations & decisions','conversation'],
  ['/workspace.html','Workspace','Objectives, learning & systems','workspace'],
  ['/index.html?controls=1','Cloud controls','Runtime & activity','cloud'],
  ['/monitoring.html','Monitoring','Read-only system evidence','cloud'],
  ['/connectors.html','Connections','Providers & capabilities','connections'],
  ['/agent-federation.html','Agent federation','Preview specialist routing','connections'],
  ['/repair-operations.html','Operations','Repairs & governed execution','operations'],
  ['/passkey-owner.html','Owner access','Passkeys & identity','access'],
  ['/github-pr-comment-canary.html','GitHub App','Scoped verification','github'],
  ['/local-workbooks.html','Workbooks','Local file tools','workbook'],
 ];
 const paths={conversation:'M4 5h16v11H9l-5 4V5Z',workspace:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',cloud:'M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 3 4 4 0 0 1-1 7H7',connections:'M8 4v5m8-5v5M5 9h14v3a7 7 0 0 1-14 0V9Zm7 10v3',operations:'m5 4 5 5-3 3-5-5m13 5 6 6-3 3-6-6M4 20l8-8m3-6 4-4 3 3-4 4',access:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-3 9 2 2 4-4',github:'M8 5 2 12l6 7m8-14 6 7-6 7m-2-17-4 20',workbook:'M5 3h14v18H5zM5 9h14M5 15h14M11 3v18'};
 function icon(id){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[id]);svg.append(p);return svg;}
 function el(tag,cls,text){const e=document.createElement(tag);e.className=cls;if(text)e.textContent=text;return e;}
 document.body.classList.add('ultron-ui');
 const isCouncil=location.pathname==='/council-room.html';
 const selected=modules.find(m=>m[0].split('?')[0]===location.pathname)||modules.find(m=>m[0]==='/workspace.html');
 const nav=el('aside','u-sidebar');nav.id='u-sidebar';nav.setAttribute('aria-label','Ultron navigation');
 const brand=el('a','u-brand');brand.href='/council-room.html';brand.append(el('span','u-mark','U'),el('span','','Ultron'));brand.append(el('small','','Owner workspace'));nav.append(brand);
 const links=el('nav','u-modules');links.setAttribute('aria-label','Modules');
 for(const [href,title,description,id] of modules){const a=el('a','u-module');a.href=href;a.title=description;a.append(icon(id),el('span','',title));if(href===selected[0])a.setAttribute('aria-current','page');links.append(a);}
 nav.append(links);
 const threadSlot=el('section','u-conversations');threadSlot.id='u-conversations';nav.append(threadSlot);
 const foot=el('footer','u-sidebar-foot');foot.append(el('span','u-owner-avatar','MW'),el('div','','Michael’s workspace'),el('small','','Owner controls · $0 paid ceiling'));nav.append(foot);
 const header=el('header','u-header');const toggle=el('button','u-menu','☰');toggle.type='button';toggle.setAttribute('aria-label','Open navigation');toggle.setAttribute('aria-controls','u-sidebar');toggle.setAttribute('aria-expanded','false');
 const breadcrumb=el('div','u-breadcrumb');breadcrumb.append(el('span','','Workspace'),el('span','','/'),el('strong','',selected[1]));
 const hint=el('a','u-header-help','Owner settings');hint.href='/passkey-owner.html';header.append(toggle,breadcrumb,hint);
 const shade=el('button','u-shade');shade.type='button';shade.setAttribute('aria-label','Close navigation');
 const close=(returnFocus=false)=>{const wasOpen=document.body.classList.contains('u-nav-open');document.body.classList.remove('u-nav-open');toggle.setAttribute('aria-expanded','false');if(returnFocus&&wasOpen)toggle.focus();};
 toggle.addEventListener('click',()=>{const open=document.body.classList.toggle('u-nav-open');toggle.setAttribute('aria-expanded',String(open));if(open)nav.querySelector('a')?.focus();});shade.addEventListener('click',()=>close(true));
 document.addEventListener('keydown',e=>{
  if(!document.body.classList.contains('u-nav-open')||!matchMedia('(max-width:800px)').matches)return;
  if(e.key==='Escape'){e.preventDefault();close(true);return;}
  if(e.key==='Tab'){
   const items=[...nav.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)')].filter(x=>x.getClientRects().length);
   const first=items[0],last=items.at(-1);if(!first)return;
   if(e.shiftKey&&(document.activeElement===first||!nav.contains(document.activeElement))){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||!nav.contains(document.activeElement))){e.preventDefault();first.focus();}
  }
 });
 document.addEventListener('ultron:close-navigation',()=>close());
 const skip=el('a','u-skip','Skip to content');skip.href='#u-main-content';
 const main=document.querySelector('main')||document.querySelector('.main');if(main){main.id=main.id||'u-main-content';skip.href='#'+main.id;}
 document.body.prepend(skip,nav,header,shade);
 if(!isCouncil)threadSlot.hidden=true;
 document.querySelectorAll('.shared-nav,.unified-nav,.cloud-return').forEach(x=>x.remove());
 const oldTop=document.querySelector('.topbar');if(oldTop){const pill=document.getElementById('system-pill');oldTop.querySelector('nav')?.remove();oldTop.querySelector('.brand')?.remove();if(pill)header.append(pill);oldTop.hidden=true;}
 document.querySelectorAll('body > nav').forEach(n=>n.hidden=true);
 const rail=document.querySelector('.shell > .rail');if(rail){rail.querySelector('.brand')?.remove();rail.querySelector('.rail-end')?.remove();rail.classList.add('u-section-tabs');}
 document.querySelectorAll('h1,h2').forEach(h=>{if(h.textContent==='Ultron is ready to evolve.')h.textContent='Your working space';});
 document.dispatchEvent(new CustomEvent('ultron:shell-ready'));
})();
