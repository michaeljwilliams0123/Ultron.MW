(()=>{'use strict';
const tile=document.getElementById('connection-council');
const value=tile.querySelector('.connection-value');
const detail=tile.querySelector('.connection-detail');
let refreshing=false;
async function refresh(){
 if(refreshing)return;
 refreshing=true;
 tile.dataset.state='warning';
 value.textContent='Checking…';
 detail.textContent='Reading owner-only Council wiring evidence';
 try{
  const response=await fetch('/api/brain/council-readiness',{
   method:'GET',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error('readback-unavailable');
  const data=await response.json();
  if(data?.schema!=='ultron.council.wiring-readiness.v1'||
     !Number.isSafeInteger(data.roleCount)||
     !Number.isSafeInteger(data.githubRoleInstallationsObserved)||
     !Array.isArray(data.missingTables)||!Array.isArray(data.rolesUnverified))
   throw Error('readback-invalid');
  tile.dataset.state=data.readyForProduction===true?'good':'warning';
  value.textContent=data.readyForProduction===true?'Release ready':'Not release ready';
  detail.textContent=data.githubRoleInstallationsObserved+' of '+data.roleCount+
   ' GitHub App identities verified · '+data.missingTables.length+
   ' missing tables · read-only assessment';
 }catch{
  tile.dataset.state='error';
  value.textContent='Unverified';
  detail.textContent='Owner-only Council wiring readback unavailable';
 }finally{refreshing=false}
}
document.getElementById('connection-refresh').addEventListener('click',refresh);
refresh();
})();
