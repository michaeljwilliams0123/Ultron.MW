(()=>{'use strict';
const tile=document.getElementById('connection-council');
const refreshButton=document.getElementById('connection-refresh');
if(!tile||!refreshButton)return;
const value=tile.querySelector('.connection-value');
const detail=tile.querySelector('.connection-detail');
if(!value||!detail)return;
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
     !Array.isArray(data.missingTables)||!Array.isArray(data.rolesUnverified)||
     typeof data.readyForProduction!=='boolean'||
     data.roleCount<1||data.githubRoleInstallationsObserved<0||
     data.githubRoleInstallationsObserved>data.roleCount)
   throw Error('readback-invalid');
  // Wiring readiness is not an independently signed production release.
  // The release-proof endpoint is a separate owner-only acceptance boundary.
  tile.dataset.state='warning';
  value.textContent=data.readyForProduction===true?'Council wiring ready':'Council wiring incomplete';
  detail.textContent=data.githubRoleInstallationsObserved+' of '+data.roleCount+
   ' GitHub App identities verified · '+data.missingTables.length+
   ' missing tables · release acceptance checked separately';
 }catch{
  tile.dataset.state='error';
  value.textContent='Unverified';
  detail.textContent='Owner-only Council wiring readback unavailable';
 }finally{refreshing=false}
}
refreshButton.addEventListener('click',refresh);
refresh();
})();
