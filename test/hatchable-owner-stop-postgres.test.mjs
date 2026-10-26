// Runs only in the ephemeral PostgreSQL CI service, never against production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';

if(process.env.ULTRON_POSTGRES_TEST==='1'){
 const run=promisify(execFile);
 const containers=execFileSync('docker',
  ['ps','--filter','ancestor=postgres:16-alpine','--format','{{.ID}}'],
  {encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.equal(containers.length,1,'exactly one ephemeral PostgreSQL CI service');
 const container=containers[0];
 const client=['exec',container,'psql','-U','ultron','-d','ultron','-X','-q','-t','-A',
  '-v','ON_ERROR_STOP=1'];
 async function sql(statement){
  const {stdout}=await run('docker',[...client,'-c',statement]);
  return stdout.trim();
 }
 function source(path){return readFileSync(new URL('../cloud/hatchable/lib/'+path,
  import.meta.url),'utf8');}
 const taskClaim=source('brain-runner.js').match(
  /const claim=await db\.query\(`([\s\S]*?)`,\[token\]\)/)?.[1];
 const actionClaim=source('mahoraga-actions.js').match(
  /const claim=await db\.query\(`([\s\S]*?)`,\[row\.id\]\)/)?.[1];
 assert.ok(taskClaim&&actionClaim,'test must execute the real admission SQL');

 async function startUncommittedPause(){
  const process=spawn('docker',['exec','-i',container,'psql','-U','ultron',
   '-d','ultron','-X','-q','-t','-A','-v','ON_ERROR_STOP=1']);
  let output='',errors='';
  process.stdout.on('data',chunk=>{output+=chunk;});
  process.stderr.on('data',chunk=>{errors+=chunk;});
  process.stdin.write("BEGIN;\nUPDATE brain_runtime_control SET paused=TRUE WHERE id=1;\nSELECT 'LOCKED';\n");
  const deadline=Date.now()+5000;
  while(!output.includes('LOCKED')&&Date.now()<deadline){
   if(process.exitCode!==null)throw Error('pause transaction exited: '+errors);
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.match(output,/LOCKED/,'pause transaction must hold its row lock');
  return async()=>{
   process.stdin.end('COMMIT;\n\\q\n');
   const code=await new Promise(resolve=>process.once('close',resolve));
   assert.equal(code,0,errors);
  };
 }
 async function waitForBlockedClaim(){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   const n=Number(await sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%brain_runtime_control%FOR SHARE%'"));
   if(n>0)return;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.fail('admission did not wait for the pause row lock');
 }

 test('a committed pause wins against an already-started worker claim',async()=>{
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for(const name of ['0001_tasks.sql','0002_events.sql','0004_mahoraga_actions.sql',
   '0005_mahoraga_scan_fairness.sql','0007_cooperative_fencing.sql',
   '0010_runtime_stop.sql']){
   await sql(readFileSync(new URL('../cloud/hatchable/migrations/'+name,
    import.meta.url),'utf8'));
  }
  await sql("INSERT INTO brain_tasks(task_key,objective) VALUES('stop-claim','repo.inspect')");
  const commit=await startUncommittedPause();
  const claim=sql(taskClaim.replaceAll('$1',"'worker-token'"));
  await waitForBlockedClaim();
  await commit();
  assert.equal(await claim,'');
  assert.equal(await sql("SELECT status FROM brain_tasks WHERE task_key='stop-claim'"),'queued');
  assert.equal(await sql("SELECT count(*) FROM brain_events WHERE event_type='claimed'"),'0');
 });

 test('a committed pause prevents a prepared action entering sent state',async()=>{
  await sql("UPDATE brain_runtime_control SET paused=FALSE WHERE id=1");
  const id=Number(await sql("INSERT INTO brain_tasks(task_key,objective,status) VALUES('stop-action','mahoraga.issue.create','external') RETURNING id"));
  const actionId=Number(await sql("INSERT INTO mahoraga_actions(task_id,action_key,operation,request) VALUES("+
   id+",'stop-action','issue.create','{}'::jsonb) RETURNING id"));
  const commit=await startUncommittedPause();
  const claim=sql(actionClaim.replaceAll('$1',String(actionId)));
  await waitForBlockedClaim();
  await commit();
  assert.equal(await claim,'');
  assert.equal(await sql('SELECT state FROM mahoraga_actions WHERE id='+actionId),'prepared');
 });
}
