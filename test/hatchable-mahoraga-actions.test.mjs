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
 pauseDuringPreflight=false,pat=false,githubAppPem=false,loseClaim=false,
 claimConflict=false,verifyConclusion='success',verifyStatus='completed',
 duplicateVerify=false,bareVerifyPath=false}={}){
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
       if(claimConflict)issues.push({number:31,title:'Edited before reconciliation',
         body:row.request.body+'\n\n<!-- ULTRON_MAHORAGA_CONTROL_V1 '+row.action_key+' -->',
         html_url:'https://github.com/example/issues/31',created_at:new Date().toISOString()});
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
   const target=new URL(url),path=target.pathname;
   calls.push({path,search:target.search,method:init.method,
     body:init.body?JSON.parse(init.body):null});
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
   if(path.endsWith('/actions/workflows/verify.yml/runs')){
     const items=duplicateVerify?[...runs,...runs.map(x=>({...x,id:100}))]:runs;
     return json({total_count:items.length,workflow_runs:items});
   }
   if(path.endsWith('/actions/runs/99/jobs'))
     return json({total_count:2,jobs:[
       {id:201,name:'Verify (ubuntu-latest)',status:verifyStatus,conclusion:verifyConclusion},
       {id:202,name:'Verify (windows-latest)',status:verifyStatus,conclusion:verifyConclusion}
     ]});
   if(path.endsWith('/actions/workflows/verify.yml/dispatches')){
     const data=JSON.parse(init.body);
     runs.push({id:99,event:'workflow_dispatch',head_sha:'b'.repeat(40),
       head_branch:'mahoraga/control',path:bareVerifyPath?
         '.github/workflows/verify.yml':'.github/workflows/verify.yml@mahoraga/control',
       display_title:'Ultron exact-head '+data.inputs?.ultron_action_key,
       status:verifyStatus,conclusion:verifyConclusion,
       created_at:new Date().toISOString()});
     return json(null,204);
   }
   if(path.endsWith('/issues')&&init.method==='POST'){
     const body=JSON.parse(init.body);
     const item={number:issues.length+1,...body,html_url:'https://github.com/example/issues/1',
       created_at:new Date().toISOString()};
     issues.push(item);
     if(uncertainWrite)throw Error('response lost');
     return json(item,201);
   }
   if(path.endsWith('/issues')){
     const perPage=Number(target.searchParams.get('per_page')||30);
     const page=Number(target.searchParams.get('page')||1);
     const ordered=target.searchParams.get('direction')==='asc'?[...issues]:[...issues].reverse();
     return json(ordered.slice((page-1)*perPage,page*perPage).map(row=>({
       created_at:'2020-01-01T00:00:00Z',...row})));
   }
   throw Error('unexpected path '+path);
 };
 return {db,config,transport,calls,rows,issues,runs};
}
const execute=(f,action=input)=>runMahoragaAction(f,action);
function waitForAbort(signal){
 return new Promise((resolve,reject)=>{
   if(signal.aborted)return reject(signal.reason);
   signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 });
}
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
test('a stalled preflight read times out before the durable send checkpoint',async()=>{
 const f=fixture({pat:true});
 const transport=f.transport;
 f.transport=(url,init)=>new URL(url).searchParams.has('per_page') &&
   new URL(url).pathname.endsWith('/issues')
   ? waitForAbort(init.signal) : transport(url,init);
 const result=await runMahoragaAction({...f,requestTimeoutMs:15,
   actionDeadlineMs:100},input);
 assert.equal(result.state,'prepared');
 assert.equal(result.error,'github-request-timeout');
 assert.equal(f.rows.get(KEY).state,'prepared');
 assert.equal(f.issues.length,0);
 assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
});
test('a timed out write remains uncertain and is reconciled without a second POST',async()=>{
 const f=fixture({pat:true});
 const transport=f.transport;
 f.transport=async(url,init)=>{
   if(new URL(url).pathname.endsWith('/issues')&&init.method==='POST'){
     await transport(url,init); // Remote service commits the issue, then loses its response.
     return waitForAbort(init.signal);
   }
   return transport(url,init);
 };
 const result=await runMahoragaAction({...f,requestTimeoutMs:15,
   actionDeadlineMs:100},input);
 assert.equal(result.state,'uncertain');
 assert.equal(f.rows.get(KEY).state,'uncertain');
 assert.equal(f.issues.length,1);
 assert.equal((await execute(f)).state,'observed');
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
 assert.deepEqual(f.calls.find(x=>x.path.endsWith('/dispatches')).body,{
   ref:'mahoraga/control',inputs:{ultron_action_key:'ultron:verify-95',
     ultron_expected_head_sha:'b'.repeat(40)}
 });
});
test('GitHub bare workflow path is accepted for the exact correlated Verify run',async()=>{
 const f=fixture({bareVerifyPath:true});
 const request={key:'ultron:verify-bare-path',operation:'verify.dispatch',
   input:{ref:'mahoraga/control',expectedHeadSha:'b'.repeat(40)}};
 const result=await execute(f,request);
 assert.equal(result.state,'observed');
 assert.equal(result.result.runId,99);
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
test('issue readback covers a repository with more than 1000 issue records',async()=>{
 const f=fixture({pat:true});
 for(let i=0;i<1178;i++)f.issues.push({number:i+1,title:'Historical issue '+i,
   body:'No canary marker',html_url:'https://github.com/example/issues/'+(i+1)});
 const result=await execute(f);
 assert.equal(result.state,'observed');
 assert.equal(result.result.number,1179);
 assert.equal(f.issues.length,1179);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,1);
 assert.ok(f.calls.some(x=>x.search.includes('page=12')&&x.search.includes('direction=asc')),
   'pre-write inventory must reach the older page in stable ascending order');
 assert.ok(f.calls.some(x=>x.search.includes('direction=desc')),
   'post-write readback must search the recent issue window');
});
test('an older-page marker conflict cannot trigger another issue',async()=>{
 const f=fixture({pat:true});
 for(let i=0;i<1178;i++)f.issues.push({number:i+1,title:'Historical issue '+i,
   body:'No canary marker',html_url:'https://github.com/example/issues/'+(i+1)});
 f.issues[1177].body='Changed content\n\n<!-- ULTRON_MAHORAGA_CONTROL_V1 '+KEY+' -->';
 const result=await execute(f);
 assert.equal(result.state,'prepared');
 assert.equal(result.error,'issue-marker-conflict');
 assert.equal(f.issues.length,1178);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,0);
});
test('an issue added between batched pages cannot hide an existing marker',async()=>{
 const f=fixture({pat:true});
 for(let i=0;i<200;i++)f.issues.push({number:i+1,title:'Historical issue '+i,
   body:'No canary marker',html_url:'https://github.com/example/issues/'+(i+1)});
 f.issues[100].body='Changed content\n\n<!-- ULTRON_MAHORAGA_CONTROL_V1 '+KEY+' -->';
 const transport=f.transport;
 let inserted=false;
 f.transport=async(url,init)=>{
   const target=new URL(url);
   if(target.pathname.endsWith('/issues')&&init.method==='GET'&&
     target.searchParams.get('direction')==='asc'){
     if(target.searchParams.get('page')==='1')
       await new Promise(resolve=>setImmediate(resolve));
     if(target.searchParams.get('page')==='2'&&!inserted){
       const response=await transport(url,init);
       f.issues.push({number:201,title:'Concurrent issue',body:'No canary marker',
         html_url:'https://github.com/example/issues/201'});
       inserted=true;
       return response;
     }
   }
   return transport(url,init);
 };
 const result=await execute(f);
 assert.equal(inserted,true);
 assert.equal(result.state,'prepared');
 assert.equal(result.error,'issue-marker-conflict');
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,0);
});
test('the last available issue slot can be written and read back',async()=>{
 const f=fixture({pat:true});
 for(let i=0;i<3999;i++)f.issues.push({number:i+1,title:'Historical issue '+i,
   body:'No canary marker',html_url:'https://github.com/example/issues/'+(i+1)});
 const result=await execute(f);
 assert.equal(result.state,'observed');
 assert.equal(result.result.number,4000);
 assert.equal(f.issues.length,4000);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,1);
 assert.ok(f.calls.some(x=>x.search.includes('page=40')&&x.search.includes('direction=asc')),
   'pre-write readback must reach the last full inventory page');
});
test('a full inventory still reconciles a new issue beyond the pre-write cap',async()=>{
 const f=fixture({pat:true});
 for(let i=0;i<4000;i++)f.issues.push({number:i+1,title:'Historical issue '+i,
   body:'No canary marker',html_url:'https://github.com/example/issues/'+(i+1)});
 const result=await execute(f);
 assert.equal(result.state,'observed');
 assert.equal(result.result.number,4001);
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,1);
});
test('an oversized pre-write issue inventory fails before the send checkpoint',async()=>{
 const f=fixture({pat:true});
 for(let i=0;i<4001;i++)f.issues.push({number:i+1,title:'Historical issue '+i,
   body:'No canary marker',html_url:'https://github.com/example/issues/'+(i+1)});
 const result=await execute(f);
 assert.equal(result.state,'prepared');
 assert.equal(result.error,'issue-reconciliation-window-exceeded');
 assert.equal(f.rows.get(KEY).state,'prepared');
 assert.equal(f.calls.filter(x=>x.path.endsWith('/issues')&&x.method==='POST').length,0);
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
 const f=fixture({loseClaim:true,claimConflict:true});
 const result=await execute(f);
 assert.equal(result.ok,false);
 assert.equal(result.error,'issue-marker-conflict');
 assert.equal(result.state,'uncertain');
 assert.equal(f.rows.get(KEY).state,'uncertain');
 assert.equal(f.calls.filter(c=>c.path.endsWith('/issues')&&c.method==='POST').length,0);
});


test('a merely queued or unsuccessful Verify run cannot be accepted as observed',async()=>{
 for(const options of [{verifyStatus:'in_progress',verifyConclusion:null},
   {verifyStatus:'completed',verifyConclusion:'failure'},
   {verifyStatus:'completed',verifyConclusion:'cancelled'}]){
  const f=fixture(options);
  const action={key:'ultron:verify-95',operation:'verify.dispatch',
    input:{ref:'mahoraga/control',expectedHeadSha:'b'.repeat(40)}};
  const result=await execute(f,action);
  assert.equal(result.state,'uncertain');
  assert.equal(f.calls.filter(x=>x.path.endsWith('/dispatches')).length,1);
  assert.equal((await execute(f,action)).state,'uncertain');
  assert.equal(f.calls.filter(x=>x.path.endsWith('/dispatches')).length,1);
 }
});

test('ambiguous or unrelated Verify runs never get silently adopted',async()=>{
 const action={key:'ultron:verify-95',operation:'verify.dispatch',
   input:{ref:'mahoraga/control',expectedHeadSha:'b'.repeat(40)}};
 const duplicate=fixture({duplicateVerify:true});
 const ambiguous=await execute(duplicate,action);
 assert.equal(ambiguous.state,'uncertain');
 assert.equal(duplicate.calls.filter(x=>x.path.endsWith('/dispatches')).length,1);
 const unrelated=fixture();
 unrelated.runs.push({id:77,event:'workflow_dispatch',head_sha:'b'.repeat(40),
   head_branch:'mahoraga/control',path:'.github/workflows/verify.yml@mahoraga/control',
   display_title:'Ultron exact-head some-other-action',
   status:'completed',conclusion:'success',created_at:new Date().toISOString()});
 const result=await execute(unrelated,action);
 assert.equal(result.state,'observed');
 assert.equal(result.result.runId,99,'readback must select the action-specific run');
});


test('truncated GitHub run pagination cannot be adopted as an unambiguous execution',async()=>{
 const f=fixture();
 const transport=f.transport;
 f.transport=async(url,init)=>{
  if(new URL(url).pathname.endsWith('/actions/workflows/verify.yml/runs')){
   const response=await transport(url,init),body=await response.json();
   return {ok:true,status:200,json:async()=>({...body,total_count:body.total_count+1})};
  }
  return transport(url,init);
 };
 const request={key:'ultron:verify-95',operation:'verify.dispatch',
   input:{ref:'mahoraga/control',expectedHeadSha:'b'.repeat(40)}};
 const result=await execute(f,request);
 assert.equal(result.state,'uncertain');
 assert.equal(f.calls.filter(x=>x.path.endsWith('/dispatches')).length,0);
});
