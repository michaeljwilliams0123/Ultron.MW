// Real SIGKILL + PostgreSQL acceptance in the disposable CI service only.
// The objective is an isolated read fixture, not an external provider write.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync,fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
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
// psql CSV preserves actual projection names and quoted fields from each query.
function parseCsv(text){
 const records=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){field+='"';i++;}
   else quoted=!quoted;
  }else if(!quoted&&(ch===','||ch==='\n')){
   row.push(field);field='';
   if(ch==='\n'){records.push(row);row=[];}
  }else if(ch!=='\r'||quoted)field+=ch;
 }
 if(field||row.length){row.push(field);records.push(row);}
 const [headers,...rows]=records;
 return rows.map(values=>Object.fromEntries(headers.map((key,i)=>{
  let value=values[i];
  if(['id','attempts','fencing_generation','version'].includes(key))value=Number(value);
  if(key==='paused')value=value==='t';
  return [key,value];
 })));
}
function literal(value){
 if(value===null)return 'NULL';
 if(typeof value==='number'){assert.ok(Number.isSafeInteger(value));return String(value);}
 return "'"+String(value).replaceAll("'","''")+"'";
}
async function harness(t,{maxAttempts=3}={}){
 const schema='ultron_process_'+randomUUID().replaceAll('-','');
 const workers=[];
 async function sql(statement){
  const result=await run('docker',['exec',container,'psql','-U','ultron','-d','ultron',
   '-X','-q','--csv','-v','ON_ERROR_STOP=1','-c',
   'SET search_path TO '+schema+'; '+statement],{maxBuffer:1024*1024,timeout:10_000});
  return result.stdout;
 }
 await sql('CREATE SCHEMA '+schema);
 t.after(async()=>{
  await Promise.all(workers.map(worker=>worker.stop()));
  await sql('DROP SCHEMA '+schema+' CASCADE');
 });
 for(const name of ['0001_tasks.sql','0002_events.sql','0007_cooperative_fencing.sql',
  '0010_runtime_stop.sql']){
  await sql(await readFile(new URL('../cloud/hatchable/migrations/'+name,import.meta.url),'utf8'));
 }
 await sql("INSERT INTO brain_tasks(task_key,objective,max_attempts) VALUES "+
  "('process-recovery','repo.inspect',"+maxAttempts+")");
 async function snapshot(){
  const rows=parseCsv(await sql(`SELECT json_build_object(
   'status',t.status,'attempts',t.attempts,'fence',t.fencing_generation,
   'result',t.last_result,'released',t.owner_token IS NULL AND t.lease_until IS NULL,
   'events',(SELECT json_agg(json_build_object('type',e.event_type,'details',e.details)
     ORDER BY e.id) FROM brain_events e WHERE e.task_id=t.id)) AS snapshot
   FROM brain_tasks t WHERE task_key='process-recovery'`));
  return JSON.parse(rows[0].snapshot);
 }
 function worker({holdObjective=false,completion='reply'}={}){
  const messages=[];
  let errors='',completionCalls=0,readbackCalls=0,exit;
  const child=fork(new URL('./helpers/hatchable-process-worker.mjs',import.meta.url),[],{
   env:{...process.env,ULTRON_HOLD_OBJECTIVE:holdObjective?'1':'0'},
   stdio:['ignore','ignore','pipe','ipc']
  });
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{exit={code,signal};resolve(exit);}));
  child.stderr.on('data',chunk=>{errors+=chunk;});
  child.on('message',async message=>{
   messages.push(message);
   if(message.type!=='query')return;
   const isCompletion=message.sql.includes("INSERT INTO brain_events")&&
    message.sql.includes("'observed'");
   if(message.sql.includes('last_result=$3::jsonb'))readbackCalls++;
   if(isCompletion)completionCalls++;
   try{
    // PREPARE preserves PostgreSQL's real parameter typing and SQL behavior.
    const statement='PREPARE worker_query AS '+message.sql+'; EXECUTE worker_query'+
     (message.params.length?'('+message.params.map(literal).join(',')+')':'')+';';
    const rows=parseCsv(await sql(statement));
    if(isCompletion&&completion!=='reply'){
     messages.push({type:'completion-committed'});
     if(completion==='hold')return; // kill before the database reply reaches the worker
     throw Error('injected-lost-database-acknowledgement');
    }
    if(child.connected)child.send({type:'query-result',id:message.id,rows});
   }catch(error){
    if(child.connected)child.send({type:'query-result',id:message.id,error:String(error.message)});
   }
  });
  const state={
   child,messages,get objectiveCalls(){return messages.filter(m=>m.type==='objective-entered').length;},
   get completionCalls(){return completionCalls;},get readbackCalls(){return readbackCalls;},
   async wait(type){
    const deadline=Date.now()+15_000;
    while(Date.now()<deadline){
     const message=messages.find(m=>m.type===type||m.type==='worker-error');
     if(message){assert.notEqual(message.type,'worker-error',message.error);return message;}
     if(exit)assert.fail('worker exited before '+type+': '+JSON.stringify(exit)+' '+errors);
     await delay(10);
    }
    assert.fail('worker did not reach '+type+': '+errors);
   },
   async result(){const message=await this.wait('result');await exited;assert.equal(exit.code,0,errors);return message.result;},
   async stop(){if(!exit)child.kill('SIGKILL');return exited;}
  };
  workers.push(state);
  return state;
 }
 return {sql,snapshot,worker,
  expire:()=>sql("UPDATE brain_tasks SET lease_until=now()-interval '1 second' WHERE status='leased'")};
}
const eventCount=(state,type)=>state.events.filter(event=>event.type===type).length;

test('SIGKILL preserves a live lease and recovers the read fixture only after expiry',options,async t=>{
 const h=await harness(t);
 const first=h.worker({holdObjective:true});
 await first.wait('objective-entered');
 assert.equal((await first.stop()).signal,'SIGKILL');
 const leased=await h.snapshot();
 assert.equal(leased.status,'leased');
 assert.equal(leased.attempts,1);
 assert.equal(leased.fence,1);
 const early=h.worker();
 assert.equal((await early.result()).status,'idle');
 assert.equal(early.objectiveCalls,0);
 await h.expire(); // bounded clock acceleration, not a production lease edit
 const restarted=h.worker();
 assert.equal((await restarted.result()).status,'done');
 const recovered=await h.snapshot();
 assert.equal(recovered.attempts,2);
 assert.equal(recovered.fence,2);
 assert.equal(recovered.released,true);
 assert.equal(eventCount(recovered,'lease-recovered'),1);
 assert.equal(eventCount(recovered,'claimed'),2);
 assert.equal(eventCount(recovered,'observed'),1);
 assert.equal(first.objectiveCalls+restarted.objectiveCalls,2,'only the read fixture is retried');
});

test('SIGKILL after completion commits does not replay the objective on restart',options,async t=>{
 const h=await harness(t);
 const first=h.worker({completion:'hold'});
 await first.wait('completion-committed');
 assert.equal((await first.stop()).signal,'SIGKILL');
 const committed=await h.snapshot();
 assert.equal(committed.status,'done');
 assert.equal(committed.result.source,'isolated-process-fixture');
 assert.equal(committed.released,true);
 assert.equal(eventCount(committed,'observed'),1);
 const restarted=h.worker();
 assert.equal((await restarted.result()).status,'idle');
 assert.equal(restarted.objectiveCalls,0);
 assert.deepEqual(await h.snapshot(),committed);
});

test('real committed SQL with a dropped acknowledgement uses one independent readback',options,async t=>{
 const h=await harness(t);
 const worker=h.worker({completion:'drop'});
 const result=await worker.result();
 assert.equal(result.status,'done');
 assert.equal(result.readback,'committed');
 assert.equal(worker.objectiveCalls,1);
 assert.equal(worker.completionCalls,1);
 assert.equal(worker.readbackCalls,1);
 const committed=await h.snapshot();
 assert.equal(committed.attempts,1);
 assert.equal(eventCount(committed,'observed'),1);
 assert.equal(committed.events.find(e=>e.type==='observed').details.fencingGeneration,1);
});

test('an expired claimant cannot overwrite the replacement worker completion',options,async t=>{
 const h=await harness(t);
 const stale=h.worker({holdObjective:true});
 await stale.wait('objective-entered');
 await h.expire();
 const replacement=h.worker();
 assert.equal((await replacement.result()).status,'done');
 const committed=await h.snapshot();
 stale.child.send({type:'release-objective'});
 assert.equal((await stale.result()).status,'lost-lease');
 assert.deepEqual(await h.snapshot(),committed);
 assert.equal(committed.fence,2);
 assert.equal(eventCount(committed,'observed'),1);
});

test('a killed final attempt becomes blocked without another objective execution',options,async t=>{
 const h=await harness(t,{maxAttempts:1});
 const first=h.worker({holdObjective:true});
 await first.wait('objective-entered');
 await first.stop();
 await h.expire();
 const restarted=h.worker();
 const result=await restarted.result();
 assert.equal(result.status,'idle');
 assert.equal(result.blocked,1);
 assert.equal(restarted.objectiveCalls,0);
 const state=await h.snapshot();
 assert.equal(state.status,'blocked');
 assert.equal(state.attempts,1);
 assert.equal(state.released,true);
 assert.equal(eventCount(state,'attempt-limit'),1);
 assert.equal(eventCount(state,'observed'),0);
});

test('persisted owner pause prevents crash recovery until resumed',options,async t=>{
 const h=await harness(t);
 const first=h.worker({holdObjective:true});
 await first.wait('objective-entered');
 await first.stop();
 await h.expire();
 await h.sql('UPDATE brain_runtime_control SET paused=TRUE,version=2 WHERE id=1');
 const paused=h.worker();
 assert.deepEqual(await paused.result(),{status:'paused',controlVersion:2});
 assert.equal(paused.objectiveCalls,0);
 assert.equal(eventCount(await h.snapshot(),'lease-recovered'),0);
 await h.sql('UPDATE brain_runtime_control SET paused=FALSE,version=3 WHERE id=1');
 assert.equal((await h.worker().result()).status,'done');
 assert.equal((await h.snapshot()).fence,2);
});
