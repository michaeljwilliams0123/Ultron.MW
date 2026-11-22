// Fast owner-only Council completion readback.
// No task execution, inference, credentials, writes, or optimistic completion.
(()=>{
 'use strict';
 if(!document.body?.classList?.contains('u-council'))return;
 const endpoint='/api/brain/council-room-progress';
 const watched=new Map();
 let room='owner-main',timer=null,checking=false,checks=0;
 const terminal=new Set(['done','blocked','canceled','failed','error']);
 const finiteId=value=>{
  const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;
 };
 const clear=()=>{if(timer!==null)clearTimeout(timer);timer=null};
 const wait=()=>{
  if(timer!==null||checking||!watched.size||document.hidden)return;
  // Quick first readback; bounded backoff on slower executions.
  const ms=checks<2?450:Math.min(5000,800+checks*500);
  timer=setTimeout(()=>{timer=null;void poll();},ms);
 };
 const watch=(taskId,nextRoom)=>{
  const id=finiteId(taskId);
  if(!id||!(/^(?:owner-main|chat-[a-f0-9-]{36})$/).test(String(nextRoom)))return;
  if(nextRoom!==room){room=nextRoom;watched.clear();checks=0;clear();}
  if(!watched.has(id))watched.set(id,Date.now());
  wait();
 };
 async function poll(){
  if(checking||!watched.size||document.hidden)return;
  const [taskId,start]=watched.entries().next().value;
  if(Date.now()-start>120000){watched.delete(taskId);checks=0;wait();return;}
  const activeRoom=room;
  checking=true;
  try{
   const url=new URL(endpoint,location.origin);
   url.searchParams.set('taskId',String(taskId));
   url.searchParams.set('room',room);
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
   if(response.status===401||response.status===403||response.status===404){
    watched.delete(taskId);checks=0;
    return;
   }
   if(!response.ok)throw Error('progress-read-unavailable');
   const result=await response.json();
   if(activeRoom!==room||!watched.has(taskId))return;
   if(result.ok&&result.taskId===taskId&&result.terminal===true&&terminal.has(result.state)){
    watched.delete(taskId);checks=0;
    // The existing Council Room GET performs authoritative receipt rendering.
    document.getElementById('refresh')?.click();
   }else checks=Math.min(8,checks+1);
  }catch{
   checks=Math.min(8,checks+1);
  }finally{
   checking=false;wait();
  }
 }
 document.addEventListener('ultron:council-submitted',event=>{
  watch(event.detail?.taskId,event.detail?.room);
 });
 document.addEventListener('ultron:council-jobs',event=>{
  const d=event.detail||{};
  if(!(/^(?:owner-main|chat-[a-f0-9-]{36})$/).test(String(d.room)))return;
  if(d.room!==room){room=d.room;watched.clear();checks=0;clear();}
  const jobs=Array.isArray(d.jobs)?d.jobs:[];
  for(const job of jobs){
   const taskId=finiteId(job.taskId);
   if(!taskId)continue;
   if(terminal.has(job.state))watched.delete(taskId);
   else if(['queued','running'].includes(job.state))watch(taskId,room);
  }
  if(!watched.size)clear();
  else wait();
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else wait();});
})();
