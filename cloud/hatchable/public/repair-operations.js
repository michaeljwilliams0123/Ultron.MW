/**
 * Read-only repair operations console. The only network action is a same-origin
 * authenticated GET; no secret material, generated HTML, or GitHub mutation.
 */
const PHASE_LABELS=Object.freeze({
 ready:'Ready', 'patch-dispatched':'Patch reconciliation',
 applied:'Patch observed',verifying:'Verifying',
 verified:'Verified — awaiting PR','publication-dispatched':'PR reconciliation',
 complete:'PR verified',exhausted:'Attempts exhausted',
 'reconcile-required':'Reconcile required'
});
const PHASE_ACTIONS=Object.freeze({
 ready:'Authorize the next bounded repair attempt',
 'patch-dispatched':'Check the existing GitHub effect; do not replay the write',
 applied:'Run or observe exact-head CI',
 verifying:'Check the existing exact-head CI run',
 verified:'Authorize publication of a reviewable PR',
 'publication-dispatched':'Read back the existing PR; do not repeat creation',
 complete:'Review the PR; merge and deploy are separate',
 exhausted:'Review failed attempts and authorize a new task'
});
const ID=/^[a-z][a-z0-9-]{7,79}$/;
const SHA=/^[a-f0-9]{40}$/;
const PR_URL=/^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/pull\/[1-9][0-9]*$/;
const ENDPOINT='/api/brain/autonomous-repairs?limit=25';

export function formatRepairPhase(value){
 return Object.hasOwn(PHASE_LABELS,value)?PHASE_LABELS[value]:'Unknown checkpoint';
}
export async function fetchRepairInventory(fetcher,endpoint=ENDPOINT){
 try{
  const response=await fetcher(endpoint,{method:'GET',credentials:'same-origin',
   cache:'no-store',headers:{accept:'application/json'},redirect:'error'});
  if(response?.status===401||response?.status===403)
   return {state:'owner-required',items:[]};
  if(response?.ok!==true||response.status!==200)
   return {state:'unavailable',items:[]};
  const body=await response.json();
  if(body?.schema!=='ultron.autonomous-repairs.status.v1'||
   body.ok!==true||!Array.isArray(body.items)||body.items.length>50||
   !Number.isFinite(Date.parse(body.observedAt)))
   return {state:'unavailable',items:[]};
  return {state:'live',items:body.items,observedAt:body.observedAt};
 }catch{
  // Never show network errors, redirect bodies, model output or auth material.
  return {state:'unavailable',items:[]};
 }
}
function publicItem(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  !ID.test(raw.id||'')||!Object.hasOwn(PHASE_LABELS,raw.phase)||
  raw.phase==='reconcile-required'||
  !SHA.test(raw.headSha||'')||!Number.isSafeInteger(raw.attempt)||
  raw.attempt<0||raw.attempt>3||
  !Number.isSafeInteger(raw.version)||raw.version<0)
  return null;
 const prUrl=raw.phase==='complete'&&
  typeof raw.prUrl==='string'&&PR_URL.test(raw.prUrl)?raw.prUrl:null;
 return Object.freeze({
  id:raw.id,phase:raw.phase,phaseLabel:formatRepairPhase(raw.phase),
  attempt:raw.attempt,maxAttempts:3,version:raw.version,
  headSha:raw.headSha,prUrl,
  updatedAt:typeof raw.updatedAt==='string'&&
   Number.isFinite(Date.parse(raw.updatedAt))?raw.updatedAt:null,
  nextAction:PHASE_ACTIONS[raw.phase],
  recoveryMode:typeof raw.recoveryMode==='string'?
   (['readback-only','authorized-repair','authorized-publication','verify',
      'manual-review','none'].includes(raw.recoveryMode)?
    raw.recoveryMode:'unknown'):'unknown'
 });
}
export function buildRepairConsoleModel(response){
 const state=['live','owner-required','unavailable'].includes(response?.state)?
  response.state:'unavailable';
 if(state!=='live')return {state,headline:state==='owner-required'?
  'Owner sign-in required':'Repair status unavailable',items:[],observedAt:null};
 const items=(Array.isArray(response.items)?response.items:[])
  .map(publicItem).filter(Boolean);
 return {state:'live',headline:items.length?
  items.length+' repair checkpoint'+(items.length===1?'':'s')+' observed':
  'No repair attempts recorded',items,observedAt:response.observedAt||null};
}
export function filterRepairItems(items,filter='all'){
 if(!Array.isArray(items))return [];
 if(filter==='needs-attention')return items.filter(x=>
  ['patch-dispatched','publication-dispatched','exhausted'].includes(x.phase));
 if(filter==='active')return items.filter(x=>!['complete','exhausted'].includes(x.phase));
 if(filter==='complete')return items.filter(x=>x.phase==='complete');
 return items;
}
function el(doc,tag,text,className){
 const node=doc.createElement(tag);
 if(text!==undefined)node.textContent=String(text);
 if(className)node.className=className;
 return node;
}
export function renderRepairConsole({doc,root,model,filter='all'}){
 if(!doc||!root)throw Error('repair-console-dom-required');
 root.replaceChildren();
 if(model.state!=='live'){
  const note=el(doc,'p',model.headline,'repair-notice');
  root.append(note);
  return;
 }
 const rows=filterRepairItems(model.items,filter);
 if(!rows.length){
  root.append(el(doc,'p',model.items.length?
   'No checkpoints match this filter.':model.headline,'repair-notice'));
  return;
 }
 for(const item of rows){
  const article=el(doc,'article',undefined,'repair-item');
  const header=el(doc,'div',undefined,'repair-item-heading');
  header.append(el(doc,'strong',item.id),el(doc,'span',item.phaseLabel,'repair-phase'));
  article.append(header);
  const meta=el(doc,'p',`Attempt ${item.attempt} / ${item.maxAttempts} (system ceiling) · Checkpoint v${item.version} · Commit ${item.headSha.slice(0,10)}`,'repair-meta');
  article.append(meta);
  article.append(el(doc,'p',item.nextAction,'repair-next'));
  if(item.updatedAt)article.append(el(doc,'p','Checkpoint observed: '+item.updatedAt,'repair-meta'));
  const actions=el(doc,'div',undefined,'repair-actions');
  const commit=el(doc,'a','Inspect exact commit');
  commit.href='https://github.com/michaeljwilliams0123/Ultron.MW/commit/'+item.headSha;
  commit.target='_blank';commit.rel='noopener noreferrer';
  actions.append(commit);
  if(item.prUrl){
   const link=el(doc,'a','Open verified PR');
   link.href=item.prUrl;link.target='_blank';link.rel='noopener noreferrer';
   actions.append(link);
  }
  const button=el(doc,'button','Copy task ID');
  button.type='button';
  button.addEventListener('click',async()=>{
   const clipboard=doc.defaultView?.navigator?.clipboard;
   if(!clipboard?.writeText){button.textContent='Copy unavailable';return;}
   try{await clipboard.writeText(item.id);button.textContent='Task ID copied';}
   catch{button.textContent='Copy unavailable';}
  });
  actions.append(button);
  const summary=el(doc,'button','Copy status summary');
  summary.type='button';
  summary.addEventListener('click',async()=>{
   const clipboard=doc.defaultView?.navigator?.clipboard;
   if(!clipboard?.writeText){summary.textContent='Copy unavailable';return;}
   const text=['Ultron repair checkpoint',item.id,item.phaseLabel,
    'Attempt '+item.attempt+' / '+item.maxAttempts,
    'Checkpoint v'+item.version,'Source commit '+item.headSha,
    item.nextAction].join('\n');
   try{await clipboard.writeText(text);summary.textContent='Status copied';}
   catch{summary.textContent='Copy unavailable';}
  });
  actions.append(summary);
  article.append(actions);
  root.append(article);
 }
}
export function initRepairConsole({doc=document,fetcher=fetch}={}){
 const root=doc.getElementById('repair-list');
 const refresh=doc.getElementById('repair-refresh');
 const filter=doc.getElementById('repair-filter');
 const state=doc.getElementById('repair-connection');
 const heading=doc.getElementById('repair-headline');
 if(!root||!refresh||!filter||!state||!heading)
  throw Error('repair-console-elements-unavailable');
 let latest={state:'unavailable',headline:'Not loaded',items:[]};
 const redraw=()=>renderRepairConsole({doc,root,model:latest,filter:filter.value});
 async function load(){
  refresh.disabled=true;
  state.textContent='Checking owner-only PostgreSQL checkpoints…';
  latest=buildRepairConsoleModel(await fetchRepairInventory(fetcher));
  heading.textContent=latest.headline;
  state.textContent=latest.state==='live'?
   'Live read-only checkpoint inventory · refreshed '+new Date().toLocaleTimeString():
   latest.state==='owner-required'?'Sign in as the Hatchable project owner to view repairs':
   'Backend unavailable or migration not applied; no completion is inferred';
  redraw();
  refresh.disabled=false;
  return latest;
 }
 refresh.addEventListener('click',()=>{void load();});
 filter.addEventListener('change',redraw);
 void load();
 return {refresh:load};
}
