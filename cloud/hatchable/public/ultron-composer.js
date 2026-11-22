// Owner conversation composer presentation only. No persistence, network, or provider actions.
(()=>{
 'use strict';
 if(!document.body.classList.contains('u-council'))return;
 const composer=document.querySelector('.conversation > .composer');
 const body=document.getElementById('composer-body');
 const actions=document.querySelector('.composer-actions');
 if(!composer||!body||!actions)return;

 composer.id='ultron-compose-area';
 const hide=document.createElement('button');
 hide.className='ultron-composer-hide';
 hide.type='button';
 hide.textContent='×';
 hide.title='Hide message input';
 hide.setAttribute('aria-label','Hide message input');
 hide.setAttribute('aria-controls',composer.id);
 actions.append(hide);

 const opener=document.createElement('button');
 opener.className='ultron-composer-reopen';
 opener.type='button';
 opener.textContent='Write message';
 opener.setAttribute('aria-label','Show message input');
 opener.setAttribute('aria-controls',composer.id);
 opener.hidden=true;
 composer.insertAdjacentElement('afterend',opener);

 if(!body.value.trim())composer.classList.add('ultron-composer-compact');
 body.addEventListener('focus',()=>composer.classList.remove('ultron-composer-compact'));
 body.addEventListener('blur',()=>{
  if(!body.value.trim()&&!composer.hidden)composer.classList.add('ultron-composer-compact');
 });
 body.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!body.value.trim()){
   body.blur();
   composer.classList.add('ultron-composer-compact');
  }
 });
 hide.addEventListener('click',()=>{
  // Hiding only changes presentation; the textarea's unsent draft remains intact.
  composer.hidden=true;
  opener.hidden=false;
  opener.focus();
 });
 opener.addEventListener('click',()=>{
  composer.hidden=false;
  opener.hidden=true;
  composer.classList.remove('ultron-composer-compact');
  body.focus();
 });
})();
