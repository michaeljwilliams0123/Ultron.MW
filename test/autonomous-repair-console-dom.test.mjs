import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
 normalizeRepairStatus,getRepairStatus,listRepairStatuses
} from '../cloud/hatchable/lib/autonomous-repair-status.js';
import {
 buildRepairConsoleModel,renderRepairConsole,filterRepairItems,
 fetchRepairInventory
} from '../cloud/hatchable/public/repair-operations.js';

const ID='repair-dom-001',SHA='b'.repeat(40);
class FakeNode{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.textContent='';}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 addEventListener(name,fn){this.listeners[name]=fn;}
}
const visit=(root,tag)=>[...(root.tagName===tag?[root]:[]),...root.children.flatMap(x=>visit(x,tag))];
const texts=(root)=>[root.textContent||'',...root.children.flatMap(texts)].join(' ');
const doc=()=>({createElement:tag=>new FakeNode(tag),
 defaultView:{navigator:{clipboard:{writeText:async()=>{}}}}});
function row(extra={}){
 return {id:ID,phase:'complete',attempt:1,maxAttempts:3,
  headSha:SHA,version:7,nextAction:'ATTACKER HTML <img src=x onerror=alert(1)>',
  recoveryMode:'none',progressPercent:100,updatedAt:'2026-11-09T23:00:00Z',
  prUrl:'https://github.com/michaeljwilliams0123/Ultron.MW/pull/27',
  errorTrace:'password=DO-NOT-RENDER',...extra};
}
test('rendered repair console ignores injected fields, uses text nodes and only verified PR links',()=>{
 const root=new FakeNode('root'),document=doc();
 const model=buildRepairConsoleModel({state:'live',items:[row()]});
 renderRepairConsole({doc:document,root,model});
 assert.equal(visit(root,'article').length,1);
 assert.equal(visit(root,'a').length,2);
 assert.equal(visit(root,'a')[0].href,
  'https://github.com/michaeljwilliams0123/Ultron.MW/commit/'+SHA);
 assert.equal(visit(root,'a')[1].href,
  'https://github.com/michaeljwilliams0123/Ultron.MW/pull/27');
 assert.doesNotMatch(texts(root),/ATTACKER HTML|DO-NOT-RENDER/);
 assert.match(texts(root),/Review the PR/);
 assert.ok(visit(root,'button')[0].listeners.click);
});
test('operator can copy a safe task identifier without copying private source',async()=>{
 let copied=null;
 const document=doc();
 document.defaultView.navigator.clipboard.writeText=async value=>{copied=value;};
 const root=new FakeNode('root');
 renderRepairConsole({doc:document,root,model:buildRepairConsoleModel({
  state:'live',items:[row()]
 })});
 await visit(root,'button')[0].listeners.click();
 assert.equal(copied,ID);
});
test('filters recovery-needed, active and completed checkpoints without mutation',()=>{
 const items=buildRepairConsoleModel({state:'live',items:[
  row(),row({id:'repair-dom-002',phase:'patch-dispatched',prUrl:null}),
  row({id:'repair-dom-003',phase:'exhausted',prUrl:null})
 ]}).items;
 assert.equal(filterRepairItems(items,'needs-attention').length,2);
 assert.equal(filterRepairItems(items,'active').length,1);
 assert.equal(filterRepairItems(items,'complete').length,1);
 const root=new FakeNode('root');
 renderRepairConsole({doc:doc(),root,
  model:{state:'live',items},filter:'needs-attention'});
 assert.equal(visit(root,'article').length,2);
 assert.equal(visit(root,'a').length,2);
 assert.equal(visit(root,'a').some(link=>link.href.includes('/pull/')),false);
});
test('fetching repair inventory uses only same-origin credentialed no-store GET',async()=>{
 let target=null,config=null;
 const response=await fetchRepairInventory(async(url,options)=>{
  target=url;config=options;
  return {status:200,ok:true,json:async()=>({
   schema:'ultron.autonomous-repairs.status.v1',ok:true,items:[],
   observedAt:'2026-11-09T23:00:00Z'
  })};
 });
 assert.equal(response.state,'live');
 assert.equal(target,'/api/brain/autonomous-repairs?limit=25');
 assert.deepEqual(config,{method:'GET',credentials:'same-origin',
  cache:'no-store',headers:{accept:'application/json'},redirect:'error'});
});
test('actual PGlite PostgreSQL data populates the owner inventory and hides payloads',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',import.meta.url),'utf8'));
  const record={id:'repair-database-001',fingerprint:createHash('sha256').update('one').digest('hex'),
   phase:'verifying',attempt:2,maxAttempts:3,headSha:SHA,version:5,prNumber:null,
   manifest:{changes:[{after:'TOP-SECRET-SOURCE-STRING'}]},
   errorTrace:'Bearer SUPER-SECRET-TOKEN'};
  await db.query(`INSERT INTO brain_autonomous_repairs
    (repair_id,fingerprint,phase,version,record_json)
    VALUES($1,$2,$3,$4,$5)`,[
    record.id,record.fingerprint,record.phase,record.version,JSON.stringify(record)
  ]);
  const item=await getRepairStatus({db,id:record.id});
  assert.equal(item.phase,'verifying');
  const all=await listRepairStatuses({db,limit:5});
  assert.equal(all.length,1);assert.equal(all[0].id,record.id);
  assert.equal(JSON.stringify(all).includes('TOP-SECRET-SOURCE-STRING'),false);
  assert.equal(JSON.stringify(all).includes('SUPER-SECRET-TOKEN'),false);
  assert.equal(normalizeRepairStatus(record).prUrl,null);
 }finally{await db.close();}
});

test('copy status summary contains only verified operational metadata, never raw traces',async()=>{
 let copied='';
 const document=doc(),root=new FakeNode('root');
 document.defaultView.navigator.clipboard.writeText=async value=>{copied=value;};
 renderRepairConsole({doc:document,root,model:buildRepairConsoleModel({
  state:'live',items:[row()]
 })});
 const statusButton=visit(root,'button').find(x=>x.textContent==='Copy status summary');
 assert.ok(statusButton);
 await statusButton.listeners.click();
 assert.match(copied,/Ultron repair checkpoint/);
 assert.match(copied,/Source commit/);
 assert.match(copied,/repair-dom-001/);
 assert.doesNotMatch(copied,/TOP-SECRET|DO-NOT-RENDER|ATTACKER HTML/);
});
