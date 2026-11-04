(()=>{
'use strict';
const start=document.getElementById('c06-live-start');
const status=document.getElementById('c06-live-status');
const rows=document.getElementById('c06-live-history');
if(!start||!status||!rows)return;
let busy=false,pending=null;
function say(message){status.textContent=message}
function fmtDate(v){
 return typeof v==='string'&&Number.isFinite(Date.parse(v))?
  new Date(v).toLocaleString():'time not verified';
}
function addRow(row){
 const li=document.createElement('li');
 const run=Number(row.provider_run_id),sha=String(row.source_sha||'');
 const label=document.createElement('strong');
 label.textContent='Receipt #'+Number(row.id)+' · '+String(row.model_decision||'unknown');
 const desc=document.createElement('small');
 desc.textContent='Model run '+run+' · '+sha.slice(0,12)+' · stop v'+
  Number(row.stop_version)+' · '+fmtDate(row.created_at);
 li.append(label,desc);
 return li;
}
async function getJSON(path,options={}){
 const response=await fetch(path,{method:'GET',cache:'no-store',
  credentials:'same-origin',headers:{Accept:'application/json'},...options,
  signal:AbortSignal.timeout(15000)});
 const body=await response.json();
 if(!response.ok){
  const err=new Error(body.error||'owner-readback-failed');
  err.status=response.status;
  throw err;
 }
 return body;
}
async function refresh(){
 try{
  const data=await getJSON('/api/brain/c06-live-canary');
  rows.replaceChildren();
  if(!Array.isArray(data.rows)||data.rows.length===0)
   rows.append(document.createElement('li')).textContent='No source-verified C06 runtime receipt recorded yet.';
  else for(const item of data.rows)rows.append(addRow(item));
  if(!pending)say(data.rows?.length?
   'Latest verified runtime receipt shown. Full production acceptance remains open.':
   'Owner ready · click to perform a source-pinned, $0 C06 verification.');
 }catch(error){
  rows.replaceChildren();
  say([401,403].includes(error.status)?
   'Owner sign-in required to view or record runtime evidence.':
   'Receipt readback unavailable; no success inferred.');
 }
}
start.addEventListener('click',async()=>{
 if(busy)return;
 busy=true;start.disabled=true;
 say('Checking owner stop authority and source evidence…');
 try{
  const control=await getJSON('/api/brain/control');
  const version=control?.control?.version;
  if(control?.control?.paused!==false||!Number.isSafeInteger(version)||version<1)
   throw Error('Runtime is stopped or its version is unavailable');
  if(!pending)pending={action:'evaluate',key:'c06-'+crypto.randomUUID(),expectedStopVersion:version};
  const result=await getJSON('/api/brain/c06-live-canary',{
   method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
   body:JSON.stringify(pending)
  });
  if(!result.ok||result.row?.model_decision!=='verified')throw Error('Canary not independently verified');
  pending=null;
  say('Verified source-linked model evaluation and committed receipt #'+Number(result.row.id)+
   '. No external write or paid model call was made.');
  await refresh();
 }catch(error){
  say('C06 canary not confirmed: '+String(error.message||error)+
   '. Retry uses the same submission key; no merge or paid model execution occurs.');
 }finally{busy=false;start.disabled=false}
});
window.addEventListener('ultron:realtime-change',refresh);
refresh();
})();
