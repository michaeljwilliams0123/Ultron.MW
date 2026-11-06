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
   '0005_mahoraga_scan_fairness.sql','0007_cooperative_fencing.sql','0008_admin_grants.sql',
   '0010_runtime_stop.sql','0016_owner_autonomy_profile.sql',
   '0017_owner_autonomy_capacity.sql','0018_deep_objectives.sql',
   '0030_mahoraga_mcp_authority.sql']){
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
  try { await waitForBlockedClaim(); }
  finally { await commit(); }
  assert.equal(await claim,'');
  assert.equal(await sql('SELECT state FROM mahoraga_actions WHERE id='+actionId),'prepared');
 });

 test('C18 PostgreSQL owner profile blocks queued work and only authorizes a mapped objective after a committed profile change',async()=>{
  // Isolated ephemeral database: this never touches the Hatchable project.
  await sql("UPDATE brain_runtime_control SET paused=FALSE WHERE id=1");
  await sql("UPDATE brain_tasks SET status='canceled' WHERE task_key='stop-claim'");
  await sql("UPDATE brain_owner_autonomy_profile SET allowed_operations='[\"research.public\"]'::jsonb,version=version+1 WHERE id=1");
  await sql("INSERT INTO brain_tasks(task_key,objective) VALUES('c18-profile-hold','repo.inspect')");
  assert.equal(await sql(taskClaim.replaceAll('$1',"'c18-owner-token'")),'');
  assert.equal(await sql("SELECT status||':'||attempts FROM brain_tasks WHERE task_key='c18-profile-hold'"),'queued:0');
  assert.equal(await sql("SELECT count(*) FROM brain_events WHERE event_type='claimed' AND task_id=(SELECT id FROM brain_tasks WHERE task_key='c18-profile-hold')"),'0');
  await sql("UPDATE brain_owner_autonomy_profile SET allowed_operations='[\"repo.inspect\"]'::jsonb,version=version+1 WHERE id=1");
  const admitted=await sql(taskClaim.replaceAll('$1',"'c18-owner-token'"));
  assert.match(admitted,/repo\.inspect/);
  assert.equal(await sql("SELECT status||':'||attempts FROM brain_tasks WHERE task_key='c18-profile-hold'"),'leased:1');

  // Unknown objective cannot borrow generic repo.inspect authority.
  await sql("INSERT INTO brain_tasks(task_key,objective) VALUES('c18-unknown-future','unregistered.write')");
  assert.equal(await sql(taskClaim.replaceAll('$1',"'c18-second-token'")),'');
  assert.equal(await sql("SELECT status||':'||attempts FROM brain_tasks WHERE task_key='c18-unknown-future'"),'queued:0');
  await assert.rejects(sql("UPDATE brain_owner_autonomy_profile SET max_paid_cents=1 WHERE id=1"),/check constraint/);
 });


 test('C18 PostgreSQL claim preserves the exact owner profile and stop-control versions in its immutable event',async()=>{
  await sql("UPDATE brain_runtime_control SET paused=FALSE WHERE id=1");
  await sql('UPDATE brain_owner_autonomy_profile SET '+
    'allowed_operations='+"'[\"repo.inspect\"]'::jsonb"+
    ',version=version+1 WHERE id=1');
  const version=Number(await sql('SELECT version FROM brain_owner_autonomy_profile WHERE id=1'));
  const stop=Number(await sql('SELECT version FROM brain_runtime_control WHERE id=1'));
  await sql("INSERT INTO brain_tasks(task_key,objective) VALUES('c18-profile-receipt','repo.inspect')");
  const claimReceipt=await sql(taskClaim.replaceAll('$1',"'policy-receipt-token'"));
  assert.match(claimReceipt,/repo\.inspect/);
  const id=Number(await sql("SELECT id FROM brain_tasks WHERE task_key='c18-profile-receipt'"));
  const details=JSON.parse(await sql('SELECT details::text FROM brain_events '+
    "WHERE task_id="+id+" AND event_type='claimed' ORDER BY id DESC LIMIT 1"));
  assert.equal(details.objective,'repo.inspect');
  assert.equal(details.attempt,1);
  assert.equal(details.profileVersion,version,
    'record exactly which owner-selected profile governed the claim');
  assert.equal(details.stopVersion,stop,
    'record exactly which independent pause-control version governed the claim');
  await sql('UPDATE brain_owner_autonomy_profile SET '+
    'allowed_operations='+"'[\"research.public\"]'::jsonb"+
    ',version=version+1 WHERE id=1');
  const persisted=JSON.parse(await sql('SELECT details::text FROM brain_events '+
    "WHERE task_id="+id+" AND event_type='claimed' ORDER BY id DESC LIMIT 1"));
  assert.equal(persisted.profileVersion,version,
    'later owner changes must not alter historical authorization evidence');
  assert.equal(persisted.stopVersion,stop);
 });


 test('C18 real PostgreSQL enforces one active lease across overlapping claims and restores capacity on completion',async()=>{
  // Only the ephemeral CI database is modified.
  await sql("UPDATE brain_runtime_control SET paused=FALSE WHERE id=1");
  await sql("UPDATE brain_tasks SET status='done',owner_token=NULL,lease_until=NULL WHERE status IN ('leased','queued')");
  await sql("UPDATE brain_owner_autonomy_profile SET allowed_operations='[\"repo.inspect\"]'::jsonb,"+
    "limits=jsonb_set(limits,'{maxConcurrent}','1'::jsonb),version=version+1 WHERE id=1");
  assert.equal(await sql('SELECT active_leases FROM brain_owner_autonomy_profile WHERE id=1'),'0');
  await sql("INSERT INTO brain_tasks(task_key,objective) VALUES('c18-capacity-a','repo.inspect'),('c18-capacity-b','repo.inspect')");
  const outcomes=await Promise.all([
    sql(taskClaim.replaceAll('$1',"'capacity-worker-a'")),
    sql(taskClaim.replaceAll('$1',"'capacity-worker-b'")),
  ]);
  assert.equal(outcomes.filter(Boolean).length,1,'only one task may lease under cap=1');
  assert.equal(await sql("SELECT count(*) FROM brain_tasks WHERE status='leased'"),'1');
  assert.equal(await sql("SELECT active_leases FROM brain_owner_autonomy_profile WHERE id=1"),'1');
  assert.equal(await sql(taskClaim.replaceAll('$1',"'capacity-worker-c'")),'',
    'capacity cannot be bypassed by a third worker');
  await sql("UPDATE brain_tasks SET status='done',owner_token=NULL,lease_until=NULL WHERE status='leased'");
  assert.equal(await sql("SELECT active_leases FROM brain_owner_autonomy_profile WHERE id=1"),'0');
  const next=await sql(taskClaim.replaceAll('$1',"'capacity-worker-d'"));
  assert.match(next,/repo\.inspect/);
  assert.equal(await sql("SELECT active_leases FROM brain_owner_autonomy_profile WHERE id=1"),'1');
  await sql("UPDATE brain_tasks SET status='queued',owner_token=NULL,lease_until=NULL WHERE status='leased'");
  assert.equal(await sql("SELECT active_leases FROM brain_owner_autonomy_profile WHERE id=1"),'0',
    'crash recovery must return a capacity slot');
  await sql("UPDATE brain_runtime_control SET paused=TRUE,version=version+1 WHERE id=1");
  assert.equal(await sql(taskClaim.replaceAll('$1',"'capacity-worker-e'")),'');
  assert.equal(await sql("SELECT active_leases FROM brain_owner_autonomy_profile WHERE id=1"),'0');
 });


 test('C06 deep objective is durable, unique, transition-fenced and deletion-protected',async()=>{
  const key='c06-deep-postgres-canary';
  await sql("INSERT INTO brain_deep_objectives (task_key,fingerprint,profile_version,stop_version) VALUES ('"+
    key+"',repeat('a',64),4,3)");
  await sql("INSERT INTO brain_deep_objectives (task_key,fingerprint,profile_version,stop_version) VALUES ('"+
    key+"',repeat('a',64),4,3) ON CONFLICT(task_key) DO NOTHING");
  assert.equal(await sql("SELECT count(*) FROM brain_deep_objectives WHERE task_key='"+key+"'"),'1');
  await assert.rejects(sql("UPDATE brain_deep_objectives SET profile_version=5 WHERE task_key='"+key+"'"),
    /deep objective identity immutable/);
  await sql("UPDATE brain_deep_objectives SET state='dispatching' WHERE task_key='"+key+"'");
  await sql("UPDATE brain_deep_objectives SET state='reconcile-required' WHERE task_key='"+key+"'");
  await sql("UPDATE brain_deep_objectives SET state='observed',issue_number=1200,"+
    "external_url='https://github.com/michaeljwilliams0123/mahoraga/issues/1200' WHERE task_key='"+key+"'");
  assert.equal(await sql("SELECT state||':'||issue_number FROM brain_deep_objectives WHERE task_key='"+key+"'"),
    'observed:1200');
  await assert.rejects(sql("UPDATE brain_deep_objectives SET state='prepared' WHERE task_key='"+key+"'"),
    /deep objective transition denied/);
  await assert.rejects(sql("DELETE FROM brain_deep_objectives WHERE task_key='"+key+"'"),
    /deep objective deletion denied/);
 });


 test('C06 PostgreSQL owner pause commits before any queued external deep-task dispatch',async()=>{
  const source=readFileSync(new URL('../cloud/hatchable/lib/deep-issue-workflow.js',
    import.meta.url),'utf8');
  const claim=source.match(/const CLAIM_SQL=`([\s\S]*?)`;/)?.[1];
  assert.ok(claim,'real deep-issue dispatch admission SQL');
  await sql("UPDATE brain_runtime_control SET paused=FALSE,version=version+1 WHERE id=1");
  await sql("UPDATE brain_owner_autonomy_profile SET preset='release',version=version+1 WHERE id=1");
  await sql("INSERT INTO brain_deep_objectives(task_key,fingerprint,profile_version,stop_version) "+
    "SELECT 'deep-pause-race',repeat('e',64),p.version,c.version "+
    "FROM brain_owner_autonomy_profile p JOIN brain_runtime_control c ON c.id=1 WHERE p.id=1");
  const commit=await startUncommittedPause();
  const admission=sql(claim.replaceAll('$1',"'deep-pause-race'").replaceAll('$2',"repeat('e',64)"));
  await waitForBlockedClaim();
  await commit();
  assert.equal(await admission,'');
  assert.equal(await sql("SELECT state FROM brain_deep_objectives WHERE task_key='deep-pause-race'"),'prepared');
 });

}
