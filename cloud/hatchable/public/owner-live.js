(()=>{
'use strict';
// Realtime access is a separate capability from the authenticated owner
// session. Failure to subscribe must not falsely label the owner signed out.
const indicator=document.getElementById('live-indicator');
const show=message=>{if(indicator)indicator.textContent=message};
let transport='starting',detail='';
function render(){
 if(transport==='connected'){show(detail);return;}
 if(transport==='auth-challenge'){
  const owner=window.ultronOwnerSessionState;
  show(owner==='authenticated'?
   'Owner authenticated · live updates unavailable; manual refresh available':
   owner==='guest'?'Owner sign-in required for live updates':
   'Verifying owner session · live updates unavailable');
  return;
 }
 show('Realtime unavailable · manual refresh available');
}
window.addEventListener('ultron:owner-session-state',render);
if(!window.hatchable?.events?.connect){
 transport='unavailable';render();return;
}
async function attach(){
 try{
  const access=await fetch('/api/brain/events-token',{
   method:'GET',credentials:'same-origin',cache:'no-store'
  });
  if(!access.ok){
   transport=access.status===401||access.status===403?
    'auth-challenge':'unavailable';render();return;
  }
  const connection=window.hatchable.events.connect({
   authUrl:'/api/brain/events-token'
  });
  const channel=connection.channel('ultron.owner');
  function updated(kind){
   transport='connected';
   detail='Live updates connected · '+(kind==='reset'?
    'reconciling after reconnect':'new persisted activity');
   render();
   window.dispatchEvent(new CustomEvent('ultron:realtime-change',{detail:{kind}}));
  }
  channel.on('changed',event=>updated(
   ['task','runtime','profile','github','note'].includes(event?.data?.kind)?
    event.data.kind:'reset'));
  channel.on('$reset',()=>updated('reset'));
  transport='connected';detail='Live channel connected · waiting for activity';render();
 }catch{
  transport='unavailable';render();
 }
}
attach();
})();
