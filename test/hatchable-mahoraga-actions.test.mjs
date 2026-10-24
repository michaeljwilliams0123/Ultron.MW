import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { runMahoragaAction,mahoragaActionStatus } from '../cloud/hatchable/lib/mahoraga-actions.js';

const MAIN='a'.repeat(40);
const KEY='ultron:issue-95-canary';
const PEM=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey
  .export({type:'pkcs8',format:'pem'});
const input={key:KEY,operation:'issue.create',
  input:{title:'Ultron control canary',body:'One bounded acceptance issue.',
    expectedMainSha:MAIN}};
function fixture({uncertainWrite=false,main=MAIN,ready=true}={}){
 const calls=[],rows=new Map(),issues=[],runs=[];
 const config={async get(name){
   if(!ready)throw Error('setup_required');
   return name.endsWith('CLIENT_ID')?'Iv1.testclient':
     name.endsWith('INSTALLATION_ID')?'321':PEM;
 }};
 const db={async query(sql,params=[]){
   if(sql.includes('INSERT INTO mahoraga_actions')){
     if(rows.has(params[0]))return {rows:[]};
     const row={id:rows.size+1,task_id:rows.size+101,
       action_key:params[0],operation:params[1],
       request:JSON.parse(params[2]),state:'prepared',attempt_started_at:null,result:null};
     rows.set(params[0],row);
     return {rows:[{id:row.id}]};
   }
   const row=[...rows.values()].find(x=>x.id===params[0])||rows.get(params[0]);
   if(sql.includes("SET state='uncertain'")){if(row.state==='sent')row.state='uncertain';return {rows:[]};}
   if(sql.includes("SET state='sent'")){
     if(row.state!=='prepared')return {rows:[]};
     row.state='sent';row.attempt_started_at=new Date().toISOString();
     return {rows:[{...row}]};
   }
   if(sql.includes("state='observed'")){
     row.state='observed';row.result=JSON.parse(params[1]);
     return {rows:[{id:row.id,state:row.state,result:row.result}]};
   }
   if(sql.includes('FROM mahoraga_actions WHERE'))return {rows:row?[{...row}]:[]};
   throw Error('unexpected SQL');
 }};
 const transport=async(url,init)=>{
   const path=new URL(url).pathname;
   calls.push({path,method:init.method});
   const json=(data,status=200)=>({ok:status<400,status,json:async()=>data});
   if(path.endsWith('/access_tokens'))return json({
     token:'fixture-installation-token',expires_at:new Date(Date.now()+3600000).toISOString(),
     repositories:[{id:1343333190,full_name:'michaeljwilliams0123/mahoraga'}],
     permissions:{contents:'read',issues:'write',actions:'write'}});
   if(path.endsWith('/mahoraga'))return json({
     id:1343333190,full_name:'michaeljwilliams0123/mahoraga',
     private:true,default_branch:'main'});
   if(path.endsWith('/git/ref/heads/main'))return json({object:{sha:main}});
   if(path.endsWith('/git/ref/heads/mahoraga/control'))
     return json({object:{sha:'b'.repeat(40)}});
   if(path.endsWith('/actions/workflows/verify.yml'))return json({id:1});
   if(path.endsWith('/actions/workflows/verify.yml/runs'))
     return json({workflow_runs:runs});
   if(path.endsWith('/actions/workflows/verify.yml/dispatches')){
     runs.push({id:99,event:'workflow_dispatch',head_sha:'b'.repeat(40),
       head_branch:'mahoraga/control',path:'.github/workflows/verify.yml',
       created_at:new Date().toISOString()});
     return json(null,204);
   }
   if(path.endsWith('/issues')&&init.method==='POST'){
     const body=JSON.parse(init.body);
     const item={number:issues.length+1,...body,html_url:'https://github.com/example/issues/1'};
     issues.push(item);
     if(uncertainWrite)throw Error('response lost');
     return json(item,201);
   }
   if(path.endsWith('/issues'))return json(issues);
   throw Error('unexpected path '+path);
 };
 return {db,config,transport,calls,rows,issues,runs};
}
const execute=(f,action=input)=>runMahoragaAction(f,action);
test('durable issue action commits sent before GitHub write and observes one canary',async()=>{
 const f=fixture();
 const result=await execute(f);
 assert.equal(result.state,'observed');
 assert.equal(result.taskId,101);
 assert.equal(result.result.number,1);
 assert.equal(f.rows.get(KEY).state,'observed');
 assert.match(f.issues[0].body,/ULTRON_MAHORAGA_CONTROL_V1/);
 assert.equal((await execute(f)).reused,true);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,1);
 assert.equal((await mahoragaActionStatus(f,KEY)).action.state,'observed');
});
test('lost GitHub write response is not replayed after a new invocation',async()=>{
 const f=fixture({uncertainWrite:true});
 assert.equal((await execute(f)).state,'uncertain');
 assert.equal(f.rows.get(KEY).state,'uncertain');
 assert.equal((await execute(f)).state,'observed');
 assert.equal(f.issues.length,1);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,1);
});
test('no credential or stale exact SHA can reach a Mahoraga write',async()=>{
 const missing=fixture({ready:false});
 assert.equal((await execute(missing)).ok,false);
 assert.equal(missing.rows.get(KEY).state,'prepared');
 assert.equal(missing.calls.length,0);
 const stale=fixture({main:'b'.repeat(40)});
 assert.equal((await execute(stale)).error,'mahoraga-exact-sha-mismatch');
 assert.equal(stale.rows.get(KEY).state,'prepared');
 assert.equal(stale.calls.filter(x=>x.method==='POST'&&x.path.endsWith('/issues')).length,0);
});
test('idempotency key cannot change a durable request',async()=>{
 const f=fixture();
 await execute(f);
 const changed={...input,input:{...input.input,title:'Different issue'}};
 assert.equal((await execute(f,changed)).error,'idempotency-key-conflict');
 assert.equal(f.issues.length,1);
});
test('exact-head Verify dispatch records one run and never dispatches twice',async()=>{
 const f=fixture();
 const request={key:'ultron:verify-95',operation:'verify.dispatch',
   input:{ref:'mahoraga/control',expectedHeadSha:'b'.repeat(40)}};
 const result=await execute(f,request);
 assert.equal(result.state,'observed');
 assert.equal(result.result.runId,99);
 assert.equal((await execute(f,request)).reused,true);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/dispatches')).length,1);
});
