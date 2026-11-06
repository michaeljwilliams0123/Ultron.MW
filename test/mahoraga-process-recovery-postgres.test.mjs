// Actual HTTP writes and process death, exclusively in disposable CI fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync,fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const enabled=process.env.ULTRON_POSTGRES_TEST==='1';
const options={skip:!enabled,timeout:45_000};
const run=promisify(execFile);
let container;
if(enabled){
 const found=execFileSync('docker',[
  'ps','--filter','ancestor=postgres:16-alpine','--format','{{.ID}}'
 ],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.equal(found.length,1,'exactly one disposable PostgreSQL CI service');
 container=found[0];
}
function csvRows(text){
 const records=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;
  }else if(!quoted&&(ch===','||ch==='\n')){
   row.push(field);field='';
   if(ch==='\n'){records.push(row);row=[];}
  }else if(ch!=='\r'||quoted)field+=ch;
 }
 if(field||row.length){row.push(field);records.push(row);}
 const [headers,...rows]=records;
 return rows.map(values=>Object.fromEntries(headers.map((key,i)=>{
  let value=values[i];
  if(['id','task_id'].includes(key))value=Number(value);
  if(key==='paused'||key==='admitted')value=value==='t';
  if(['request','result'].includes(key))value=value?JSON.parse(value):null;
  return [key,value];
 })));
}
function literal(value){
 if(value===null)return 'NULL';
 if(typeof value==='number'){assert.ok(Number.isSafeInteger(value));return String(value);}
 return "'"+String(value).replaceAll("'","''")+"'";
}
async function until(predicate,message){
 const deadline=Date.now()+15_000;
 while(Date.now()<deadline){if(predicate())return;await delay(10);}
 assert.fail(message);
}
async function harness(t,{providerMode='normal'}={}){
 const schema='ultron_provider_'+randomUUID().replaceAll('-','');
 const workers=[],issues=[];
 let posts=0,server;
 async function sql(statement){
  const result=await run('docker',['exec',container,'psql','-U','ultron','-d','ultron',
   '-X','-q','--csv','-v','ON_ERROR_STOP=1','-c',
   'SET search_path TO '+schema+'; '+statement],{maxBuffer:1024*1024,timeout:10_000});
  return result.stdout;
 }
 await sql('CREATE SCHEMA '+schema);
 t.after(async()=>{
  await Promise.all(workers.map(worker=>worker.stop()));
  if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
  await sql('DROP SCHEMA '+schema+' CASCADE');
 });
 for(const name of ['0001_tasks.sql','0002_events.sql','0003_native_commands.sql',
  '0004_mahoraga_actions.sql','0008_admin_grants.sql','0010_runtime_stop.sql',
  '0016_owner_autonomy_profile.sql','0030_mahoraga_mcp_authority.sql']){
  await sql(await readFile(new URL('../cloud/hatchable/migrations/'+name,import.meta.url),'utf8'));
 }
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.invalid');
  const prefix='/repos/michaeljwilliams0123/mahoraga';
  const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/_fixture/state')return json({posts,issues});
  if(url.pathname===prefix)return json({id:1343333190,
   full_name:'michaeljwilliams0123/mahoraga',private:true,default_branch:'main'});
  if(url.pathname===prefix+'/git/ref/heads/main')return json({object:{sha:'a'.repeat(40)}});
  if(url.pathname===prefix+'/actions/workflows/verify.yml')return json({id:1});
  if(url.pathname!==prefix+'/issues')return json({error:'unexpected-fixture-path'},404);
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const input=JSON.parse(body);
   posts++;
   const issue={...input,number:issues.length+1,created_at:new Date().toISOString(),
    user:{login:'isolated-provider-fixture',type:'Bot'},
    html_url:'https://github.com/michaeljwilliams0123/mahoraga/issues/'+(issues.length+1)};
   issues.push(issue);
   if(providerMode==='lose-response'){res.destroy();return;}
   if(providerMode==='hold-response')return;
   return json(issue,201);
  }
  const ordered=url.searchParams.get('direction')==='asc'?[...issues]:[...issues].reverse();
  const size=Number(url.searchParams.get('per_page')||30),page=Number(url.searchParams.get('page')||1);
  return json(ordered.slice((page-1)*size,page*size));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 async function providerState(){return (await fetch(origin+'/_fixture/state')).json();}
 async function snapshot(){
  const actions=csvRows(await sql('SELECT id,task_id,action_key,operation,request,state,result FROM mahoraga_actions ORDER BY id'));
  const counts=csvRows(await sql(`SELECT json_build_object(
   'tasks',(SELECT count(*) FROM brain_tasks),'actions',(SELECT count(*) FROM mahoraga_actions),
   'admitted',(SELECT count(*) FROM brain_events WHERE event_type='mahoraga-admitted')) AS counts`));
  return {actions,counts:JSON.parse(counts[0].counts)};
 }
 function worker({holdBeforePost=false,changed=false,dropObservation=false,
  readbackUnavailable=false,tamperResult=false}={}){
  const messages=[];
  let errors='',exit,dropped=false;
  const child=fork(new URL('./helpers/mahoraga-process-worker.mjs',import.meta.url),[],{
   env:{ULTRON_TEST_PROVIDER_ORIGIN:origin,ULTRON_TEST_HOLD_BEFORE_POST:holdBeforePost?'1':'0',
    ULTRON_TEST_CHANGED_REQUEST:changed?'1':'0'},stdio:['ignore','ignore','pipe','ipc']
  });
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{exit={code,signal};resolve(exit);}));
  child.stderr.on('data',chunk=>{errors+=chunk;});
  child.on('message',async message=>{
   messages.push(message);
   if(message.type!=='query')return;
   try{
    if(readbackUnavailable&&message.sql.includes('result=$6::jsonb'))throw Error('injected-readback-unavailable');
    const command='PREPARE action_query AS '+message.sql+'; EXECUTE action_query'+
     (message.params.length?'('+message.params.map(literal).join(',')+')':'')+';';
    const rows=csvRows(await sql(command));
    if(dropObservation&&!dropped&&message.sql.includes("SET state='observed'")){
     dropped=true;
     if(tamperResult)await sql("UPDATE mahoraga_actions SET result='{\"kind\":\"tampered\"}'::jsonb WHERE id="+message.params[0]);
     throw Error('injected-observation-reply-loss');
    }
    if(child.connected)child.send({type:'query-result',id:message.id,rows});
   }catch(error){
    if(child.connected)child.send({type:'query-result',id:message.id,error:String(error.message)});
   }
  });
  const state={messages,
   async wait(type){
    await until(()=>messages.some(m=>m.type===type||m.type==='worker-error')||!!exit,
     'worker did not reach '+type+': '+errors);
    const message=messages.find(m=>m.type===type||m.type==='worker-error');
    assert.ok(message,'worker exited before '+type+': '+errors);
    assert.notEqual(message.type,'worker-error',message.error);
    return message;
   },
   async result(){const m=await this.wait('result');await exited;assert.equal(exit.code,0,errors);return m.result;},
   async stop(){if(!exit)child.kill('SIGKILL');return exited;}
  };
  workers.push(state);return state;
 }
 return {worker,snapshot,providerState,sql,
  waitForWrite:()=>until(()=>posts>0,'provider did not commit fixture write')};
}

test('signed prepared action checks grant expiry and profile version on recovery',options,async t=>{
 const h=await harness(t);
 await h.sql(`UPDATE brain_owner_autonomy_profile SET
  allowed_operations=allowed_operations || '["repo.issue.create"]'::jsonb WHERE id=1`);
 const source=await readFile(new URL('../cloud/hatchable/lib/mcp-mahoraga-grant.js',import.meta.url),'utf8');
 const admission=source.match(/const ADMIT=`([\s\S]*?)`;/)?.[1];
 assert.ok(admission,'exercise the production admission statement');
 const values=['test:mahoraga-process-recovery','issue.create',JSON.stringify({
  title:'Isolated recovery fixture',body:'Disposable HTTP provider fixture. No real GitHub write.',
  expectedMainSha:'a'.repeat(40)}),'test-grant-123','repo.issue.create',
  'sha256:'+'b'.repeat(64),'a'.repeat(64),'2099-01-01T00:00:00Z',1,1,'b'.repeat(64)];
 const statement=admission.replace(/\$(11|10|[1-9])/g,(_,n)=>literal(values[Number(n)-1]));
 await h.sql(statement);
 assert.equal((await h.snapshot()).actions[0].state,'prepared');
 await h.sql("UPDATE brain_authority_grants SET expires_at='2000-01-01' WHERE grant_id='test-grant-123'");
 assert.equal((await h.worker().result()).error,'dispatch-authority-unavailable');
 assert.equal((await h.providerState()).posts,0);
 await h.sql(`UPDATE brain_authority_grants SET expires_at='2099-01-01' WHERE grant_id='test-grant-123';
  UPDATE brain_owner_autonomy_profile SET version=2 WHERE id=1`);
 assert.equal((await h.worker().result()).error,'dispatch-authority-unavailable');
 assert.equal((await h.providerState()).posts,0);
 await h.sql('UPDATE brain_owner_autonomy_profile SET version=1 WHERE id=1');
 assert.equal((await h.worker().result()).state,'observed');
 assert.equal((await h.providerState()).posts,1);
});

test('signed provider claim is atomic, one-shot and stop-fenced in PostgreSQL',options,async t=>{
 const h=await harness(t);
 await h.sql(await readFile(new URL('../cloud/hatchable/migrations/0031_mcp_provider_writes.sql',import.meta.url),'utf8'));
 await h.sql(`UPDATE brain_owner_autonomy_profile SET
  allowed_operations=allowed_operations || '["github.issue.write"]'::jsonb WHERE id=1`);
 const source=await readFile(new URL('../cloud/hatchable/lib/mcp-provider-write.js',import.meta.url),'utf8');
 const claim=source.match(/const CLAIM=`([\s\S]*?)`;/)?.[1];
 const check=source.match(/const CHECK=`([\s\S]*?)`;/)?.[1];
 const observe=source.match(/const OBSERVE=`([\s\S]*?)`;/)?.[1];
 assert.ok(claim&&check&&observe,'exercise production provider SQL');
 const fingerprint='b'.repeat(64),resource='c'.repeat(64);
 const values=['provider-test-1','github.issue.write',fingerprint,'provider-grant-1',
  'sha256:'+fingerprint,'a'.repeat(64),'2099-01-01T00:00:00Z',1,1,resource];
 const interpolate=(sql,params)=>sql.replace(/\$(10|[1-9])/g,(_,n)=>literal(params[Number(n)-1]));
 const claims=await Promise.all([h.sql(interpolate(claim,values)),h.sql(interpolate(claim,values))]);
 assert.equal(claims.filter(text=>csvRows(text).length===1).length,1);
 assert.equal(csvRows(await h.sql(interpolate(check,[values[0],fingerprint,values[3]])))[0].admitted,true);
 await h.sql('UPDATE brain_runtime_control SET paused=TRUE WHERE id=1');
 assert.equal(csvRows(await h.sql(interpolate(check,[values[0],fingerprint,values[3]])))[0].admitted,false);
 const evidence=JSON.stringify({providerAcknowledged:true,readbackMatches:true,issueNumber:42,state:'closed'});
 await h.sql(interpolate(observe,[values[0],fingerprint,values[3],evidence]));
 assert.equal(csvRows(await h.sql("SELECT status FROM brain_mcp_provider_writes WHERE action_key='provider-test-1'"))[0].status,'observed');
 assert.equal(csvRows(await h.sql("SELECT count(*) AS count FROM brain_events WHERE event_type='mcp-provider-write-observed'"))[0].count,'1');
});

test('lost HTTP response is reconciled by a new process with one provider write',options,async t=>{
 const h=await harness(t,{providerMode:'lose-response'});
 assert.equal((await h.worker().result()).state,'uncertain');
 assert.equal((await h.snapshot()).actions[0].state,'uncertain');
 const recovered=await h.worker().result();
 assert.equal(recovered.state,'observed');
 assert.equal(recovered.result.number,1);
 assert.equal((await h.worker().result()).reused,true);
 assert.equal((await h.worker({changed:true}).result()).error,'idempotency-key-conflict');
 const provider=await h.providerState();
 assert.equal(provider.posts,1);
 assert.equal(provider.issues.length,1);
 assert.equal(provider.issues[0].user.login,'isolated-provider-fixture');
 assert.match(provider.issues[0].body,/ULTRON_MAHORAGA_CONTROL_V1 test:mahoraga-process-recovery/);
 const persisted=await h.snapshot();
 assert.deepEqual(persisted.counts,{tasks:1,actions:1,admitted:1});
 assert.equal(persisted.actions[0].task_id,recovered.taskId);
});

test('SIGKILL after provider commit reconciles sent state without another POST',options,async t=>{
 const h=await harness(t,{providerMode:'hold-response'});
 const first=h.worker();
 await h.waitForWrite();
 assert.equal((await first.stop()).signal,'SIGKILL');
 assert.equal((await h.snapshot()).actions[0].state,'sent');
 assert.equal((await h.worker().result()).state,'observed');
 assert.equal((await h.providerState()).posts,1);
});

test('SIGKILL after send admission but before HTTP dispatch never replays the write',options,async t=>{
 const h=await harness(t);
 const first=h.worker({holdBeforePost:true});
 await first.wait('before-provider-post');
 assert.equal((await first.stop()).signal,'SIGKILL');
 assert.equal((await h.snapshot()).actions[0].state,'sent');
 assert.equal((await h.worker().result()).state,'uncertain');
 assert.equal((await h.worker().result()).state,'uncertain');
 assert.equal((await h.providerState()).posts,0);
});

test('committed observation with a lost database reply is read back exactly once',options,async t=>{
 const h=await harness(t);
 const worker=h.worker({dropObservation:true});
 const result=await worker.result();
 assert.equal(result.state,'observed');
 assert.equal(result.readback,'committed');
 assert.equal(worker.messages.filter(m=>m.type==='query'&&m.sql.includes('result=$6::jsonb')).length,1);
 assert.equal((await h.worker().result()).reused,true);
 assert.equal((await h.providerState()).posts,1);
 assert.equal((await h.snapshot()).actions[0].result.number,1);
});

test('a changed persisted result cannot satisfy observation response-loss readback',options,async t=>{
 const h=await harness(t);
 const result=await h.worker({dropObservation:true,tamperResult:true}).result();
 assert.equal(result.state,'uncertain');
 assert.equal(result.readback,undefined);
 assert.equal((await h.providerState()).posts,1);
});

test('unavailable observation readback remains uncertain without another POST',options,async t=>{
 const h=await harness(t);
 const result=await h.worker({dropObservation:true,readbackUnavailable:true}).result();
 assert.equal(result.state,'uncertain');
 assert.equal(result.readback,undefined);
 assert.equal((await h.worker().result()).reused,true);
 assert.equal((await h.providerState()).posts,1);
});
