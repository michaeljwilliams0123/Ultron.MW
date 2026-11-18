(()=>{'use strict';
const tile=document.getElementById('connection-council');
const refreshButton=document.getElementById('connection-refresh');
if(!tile||!refreshButton)return;
const value=tile.querySelector('.connection-value');
const detail=tile.querySelector('.connection-detail');
if(!value||!detail)return;
let refreshing=false;
let schemaReady=false;
const probeButton=document.createElement('button');
probeButton.type='button';
probeButton.textContent='Verify GitHub App connection';
probeButton.disabled=true;
tile.appendChild(probeButton);
async function probe(){
 if(!schemaReady||probeButton.disabled)return;
 probeButton.disabled=true;
 value.textContent='Verifying GitHub App…';
 try{
  const response=await fetch('/api/brain/github-app-proof',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{Accept:'application/json','Content-Type':'application/json'},
   body:JSON.stringify({mode:'probe'}),signal:AbortSignal.timeout(45000)
  });
  const proof=await response.json();
  if(!response.ok||proof?.schema!=='ultron.github-app-installation-proof.v1'||
   proof.state!=='installation-and-scoped-read-verified'||
   proof.installationVerified!==true||proof.repositoryReadVerified!==true||
   proof.repository!=='michaeljwilliams0123/Ultron.MW'||proof.repositoryId!==1424939667||
   proof.appId!==5633654||proof.installationId!==179066535)
   throw Error('app-proof-unverified');
  tile.dataset.state='good';
  value.textContent='GitHub App connected';
  detail.textContent='Council schema present · App 5633654 / installation 179066535 verified · '+
   'repository metadata read verified · seven reasoning roles · release acceptance checked separately';
 }catch{
  tile.dataset.state='warning';
  value.textContent='GitHub App unverified';
  detail.textContent='Council schema present · App probe did not verify the pinned installation · retry verification';
 }finally{probeButton.disabled=!schemaReady;}
}
probeButton.addEventListener('click',probe);
async function refresh(){
 if(refreshing)return;
 refreshing=true;
 schemaReady=false;probeButton.disabled=true;
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
  schemaReady=data.missingTables.length===0;
  value.textContent=schemaReady?'Council schema ready':'Council schema incomplete';
  detail.textContent=data.missingTables.length+' missing tables · '+data.roleCount+
   ' reasoning roles · GitHub App connection not checked · use Verify GitHub App connection';
  probeButton.disabled=!schemaReady;
 }catch{
  tile.dataset.state='error';
  value.textContent='Unverified';
  detail.textContent='Owner-only Council wiring readback unavailable';
 }finally{refreshing=false}
}
refreshButton.addEventListener('click',refresh);
refresh();
})();
