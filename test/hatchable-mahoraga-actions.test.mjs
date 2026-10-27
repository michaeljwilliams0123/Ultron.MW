import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { runMahoragaAction,mahoragaActionStatus } from '../cloud/hatchable/lib/mahoraga-actions.js';

const MAIN='a'.repeat(40);
const KEY='ultron:issue-95-canary';
const RSA_KEY=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
const PEM=RSA_KEY.export({type:'pkcs8',format:'pem'});
const GITHUB_APP_PEM=RSA_KEY.export({type:'pkcs1',format:'pem'});
const input={key:KEY,operation:'issue.create',
  input:{title:'Ultron control canary',body:'One bounded acceptance issue.',
    expectedMainSha:MAIN}};
function fixture({uncertainWrite=false,main=MAIN,ready=true,paused=false,
 pauseDuringPreflight=false,pat=false,githubAppPem=false,loseClaim=false}={}){
 const calls=[],rows=new Map(),issues=[],runs=[];
 let stopped=paused,claimLost=loseClaim;
 const config={async get(name){
   if(!ready)throw Error('setup_required');
   if(name==='ULTRON_MAHORAGA_CONNECTION1026')return pat?'github_pat_'+'A'.repeat(42):null;
   return name.endsWith('CLIENT_ID')?'Iv1.testclient':
     name.endsWith('INSTALLATION_ID')?'321':githubAppPem?GITHUB_APP_PEM:PEM;
 }};
 const db={async query(sql,params=[]){
   if(sql.includes('SELECT paused FROM brain_runtime_control')&&
      !sql.includes("SET state='sent'"))return {rows:[{paused:stopped}]};
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
     assert.match(sql,/brain_runtime_control WHERE id=1 FOR SHARE/);
     assert.match(sql,/AND NOT control\.paused/);
     if(stopped)return {rows:[]};
     if(row.state!=='prepared')return {rows:[]};
     if(claimLost){
       claimLost=false;
       row.state='sent';row.attempt_started_at=new Date().toISOString();
       return {rows:[]};
     }
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
   if(path.endsWith('/access_tokens')){
     const jwt=String(init.headers.Authorization||'').replace(/^Bearer /,'');
     const parts=jwt.split('.');
     assert.equal(parts.length,3,'JWT must contain header, payload, signature');
     assert.equal(JSON.parse(Buffer.from(parts[0],'base64url').toString()).alg,'RS256');
     assert.equal(JSON.parse(Buffer.from(parts[1],'base64url').toString()).iss,'Iv1.testclient');
     assert.equal(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),
       createPublicKey(RSA_KEY),Buffer.from(parts[2],'base64url')),true,
       'JWT must be signed by the test app private key');
     return json({
     token:'fixture-installation-token',expires_at:new Date(Date.now()+3600000).toISOString(),
     repositories:[{id:1343333190,full_name:'michaeljwilliams0123/mahoraga'}],
     permissions:{contents:'read',issues:'write',actions:'write'}});
   }
   if(path.endsWith('/mahoraga'))return json({
     id:1343333190,full_name:'michaeljwilliams0123/mahoraga',
     private:true,default_branch:'main'});
   if(path.endsWith('/git/ref/heads/main')){
     if(pauseDuringPreflight)stopped=true;
     return json({object:{sha:main}});
   }
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

test('owner stop keeps a prepared action unsubmitted even with valid GitHub credentials',async()=>{
 const f=fixture({paused:true});
 const result=await execute(f);
 assert.equal(result.ok,false);
 assert.equal(result.state,'prepared');
 assert.equal(result.error,'owner-execution-paused');
 assert.equal(f.calls.length,0,'no App token should even be requested');
 assert.equal(f.rows.get(KEY).state,'prepared');
});
test('pause during preflight prevents dispatch admission and an external POST',async()=>{
 const f=fixture({pauseDuringPreflight:true});
 const result=await execute(f);
 assert.equal(result.error,'owner-execution-paused');
 assert.equal(result.state,'prepared');
 assert.equal(f.rows.get(KEY).state,'prepared');
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,0);
});

test('PAT lane performs durable bounded issue write without App installation token',async()=>{
 const f=fixture({pat:true});
 const result=await execute(f);
 assert.equal(result.state,'observed');
 assert.equal(result.result.kind,'issue');
 assert.equal(f.issues.length,1);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/access_tokens')).length,0);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,1);
});
test('App installation lane remains compatible when PAT is absent',async()=>{
 const f=fixture({pat:false});
 const result=await execute(f);
 assert.equal(result.state,'observed');
 assert.equal(f.calls.filter(x=>x.path.endsWith('/access_tokens')).length,1);
});


test('an edited issue bearing this action marker cannot trigger duplicate creation',async()=>{
 const f=fixture();
 f.issues.push({number:31,title:'Edited externally',
   body:'An operator changed this existing issue.\\n\\n<!-- ULTRON_MAHORAGA_CONTROL_V1 '+KEY+' -->',
   html_url:'https://github.com/example/issues/31'});
 const result=await execute(f);
 assert.notEqual(result.state,'observed','content mismatch must not be adopted');
 assert.equal(f.issues.length,1,'must not create a second issue with the same marker');
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,0);
});

test('standard GitHub App downloaded RSA private key is accepted for signing',async()=>{
 const f=fixture({githubAppPem:true});
 const result=await execute(f);
 assert.equal(result.state,'observed');
 assert.equal(f.issues.length,1);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/access_tokens')).length,1);
});

test('retrying an uncertain action with a changed matching-marker issue stays conflicted',async()=>{
 const f=fixture({uncertainWrite:true});
 assert.equal((await execute(f)).state,'uncertain');
 f.issues[0].title='Edited after external create';
 const result=await execute(f);
 assert.equal(result.ok,false);
 assert.equal(result.error,'issue-marker-conflict');
 assert.equal(result.state,'uncertain');
 assert.equal(f.rows.get(KEY).state,'uncertain');
 assert.equal(f.issues.length,1);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/issues')&&c.method==='POST').length,1);
});

test('concurrent loser of sent claim returns durable marker conflict, not exception',async()=>{
 const f=fixture({loseClaim:true});
 f.issues.push({number:31,title:'Edited before reconciliation',
   body:input.input.body+'\\n\\n<!-- ULTRON_MAHORAGA_CONTROL_V1 '+KEY+' -->',
   html_url:'https://github.com/example/issues/31'});
 const result=await execute(f);
 assert.equal(result.ok,false);
 assert.equal(result.error,'issue-marker-conflict');
 assert.equal(result.state,'uncertain');
 assert.equal(f.rows.get(KEY).state,'uncertain');
 assert.equal(f.calls.filter(c=>c.path.endsWith('/issues')&&c.method==='POST').length,0);
});
