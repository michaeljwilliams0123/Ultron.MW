(()=>{
'use strict';
// The Hatchable runtime manages connection state, reconnect and event replay.
// A native message is only an invalidation hint; refresh trusted API readbacks.
const indicator=document.getElementById('live-indicator');
const show=message=>{if(indicator)indicator.textContent=message};
if(!window.hatchable?.events?.connect){show('Realtime transport unavailable · manual refresh available');return}
async function attach(){
 try{
  // Do not establish an owner subscription from an unauthenticated page.
  const access=await fetch('/api/brain/events-token',{method:'GET',credentials:'same-origin',cache:'no-store'});
  if(!access.ok){
   show(access.status===401||access.status===403?
    'Sign in for live private updates':'Realtime unavailable · manual refresh available');
   return;
  }
  const connection=window.hatchable.events.connect({authUrl:'/api/brain/events-token'});
  const channel=connection.channel('ultron.owner');
  function updated(kind){
   show('Live updates connected · '+(kind==='reset'?'reconciling after reconnect':'new persisted activity'));
   window.dispatchEvent(new CustomEvent('ultron:realtime-change',{detail:{kind}}));
  }
  channel.on('changed',event=>updated(
   ['task','runtime','profile','github','note'].includes(event?.data?.kind)?event.data.kind:'reset'));
  channel.on('$reset',()=>updated('reset'));
  show('Live channel connected · waiting for activity');
 }catch{
  show('Realtime setup unavailable · manual refresh available');
 }
}
attach();
})();
