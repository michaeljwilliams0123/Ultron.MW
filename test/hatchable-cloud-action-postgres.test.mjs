// Executes the production SQL against the ephemeral PostgreSQL CI service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';

if(process.env.ULTRON_POSTGRES_TEST==='1'){
 const run=promisify(execFile);
 const containers=execFileSync('docker',
  ['ps','--filter','ancestor=postgres:16-alpine','--format','{{.ID}}'],
  {encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.equal(containers.length,1,'exactly one ephemeral PostgreSQL CI service');
 const client=['exec',containers[0],'psql','-U','ultron','-d','ultron','-X','-q','-t','-A',
  '-v','ON_ERROR_STOP=1'];
 async function sql(statement){
  const {stdout}=await run('docker',[...client,'-c',statement]);
  return stdout.trim();
 }
 const migration=name=>readFileSync(new URL('../cloud/hatchable/migrations/'+name,
  import.meta.url),'utf8');
 const source=readFileSync(new URL('../cloud/hatchable/lib/cloud-native-action.js',
  import.meta.url),'utf8');
 const write=source.match(/const WRITE_SQL=`([\s\S]*?)`;/)?.[1];
 assert.ok(write,'test the actual production statement');
 const writeCanary=(key='cloud:note:pg-0001',profile=2,stop=1)=>write.replace(
  /\$([1-6])/g,(_,n)=>({1:`'${key}'`,2:`'${'a'.repeat(64)}'`,
   3:"'observation'",4:"'cloud action pg canary'",5:String(profile),6:String(stop)})[n]);

 test('native cloud action is atomic, keyed, pause-fenced and immutable in PostgreSQL',async()=>{
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for(const name of ['0001_tasks.sql','0002_events.sql','0003_native_commands.sql','0008_admin_grants.sql',
   '0010_runtime_stop.sql','0016_owner_autonomy_profile.sql',
   '0019_cloud_actions.sql'])await sql(migration(name));
  await sql(`UPDATE brain_owner_autonomy_profile SET preset='release',version=2,
    allowed_operations=allowed_operations || '["cloud.note.create"]'::jsonb WHERE id=1`);
  const created=await sql(writeCanary());
  assert.match(created,/^1\|1$/);
  assert.equal(await sql(writeCanary()),'');
  assert.equal(await sql("SELECT count(*) FROM brain_notes WHERE action_key='cloud:note:pg-0001'"),'1');
  assert.equal(await sql("SELECT count(*) FROM brain_events WHERE event_type='cloud-action-observed'"),'1');
  await assert.rejects(sql("UPDATE brain_notes SET body='changed' WHERE action_key='cloud:note:pg-0001'"),/immutable/);
  await assert.rejects(sql("DELETE FROM brain_notes WHERE action_key='cloud:note:pg-0001'"),/deletion denied/);
  assert.equal(await sql(writeCanary('cloud:note:pg-0002',3)),'');
  await sql('UPDATE brain_runtime_control SET paused=TRUE WHERE id=1');
  assert.equal(await sql(writeCanary('cloud:note:pg-0003')),'');
  assert.equal(await sql('SELECT count(*) FROM brain_notes WHERE action_key IS NOT NULL'),'1');
 });
 test('signed MCP note consumes one grant with the note and receipt atomically',async()=>{
  const signed=readFileSync(new URL('../cloud/hatchable/lib/mcp-signed-note.js',
   import.meta.url),'utf8').match(/const WRITE=`([\s\S]*?)`;/)?.[1];
  assert.ok(signed,'test the actual signed note statement');
  await sql('UPDATE brain_runtime_control SET paused=FALSE WHERE id=1');
  const statement=(key,grant)=>signed.replace(/\$(10|[1-9])/g,(_,n)=>({
   1:`'${key}'`,2:`'${'b'.repeat(64)}'`,3:"'goal'",4:"'signed pg canary'",
   5:'2',6:'1',7:`'${grant}'`,8:`'sha256:${'b'.repeat(64)}'`,
   9:`'${'a'.repeat(64)}'`,10:"'2099-01-01T00:00:00Z'"
  })[n]);
  const first=statement('cloud:note:pg-signed-1','pg-signed-grant-1');
  const results=await Promise.all([sql(first),sql(first)]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(await sql("SELECT count(*) FROM brain_notes WHERE action_key='cloud:note:pg-signed-1'"),'1');
  assert.equal(await sql("SELECT count(*) FROM brain_authority_grants WHERE grant_id='pg-signed-grant-1'"),'1');
  assert.equal(await sql("SELECT count(*) FROM brain_events WHERE event_type='mcp-cloud-note-observed' AND details->>'grant_id'='pg-signed-grant-1'"),'1');
  assert.equal(await sql(statement('cloud:note:pg-signed-2','pg-signed-grant-1')),'');
  await sql('UPDATE brain_runtime_control SET paused=TRUE WHERE id=1');
  assert.equal(await sql(statement('cloud:note:pg-signed-3','pg-signed-grant-2')),'');
  assert.equal(await sql("SELECT count(*) FROM brain_authority_grants WHERE grant_id='pg-signed-grant-2'"),'0');
 });
 test('signed queue and control are atomic and one-use in PostgreSQL',async()=>{
  await sql(migration('0029_mcp_mutation_ledger.sql'));
  await sql(`UPDATE brain_runtime_control SET paused=FALSE WHERE id=1;
   UPDATE brain_owner_autonomy_profile SET
    allowed_operations=allowed_operations || '["mcp.queue.submit","mcp.task.control"]'::jsonb WHERE id=1`);
  const signed=readFileSync(new URL('../cloud/hatchable/lib/mcp-signed-mutation.js',
   import.meta.url),'utf8').match(/const WRITE=`([\s\S]*?)`;/)?.[1];
  assert.ok(signed,'test actual MCP mutation statement');
  const statement=({key,grant,operation,action,id='NULL'})=>signed.replace(/\$(11|10|[1-9])/g,(_,n)=>({
   1:`'${key}'`,2:`'${'c'.repeat(64)}'`,3:`'${operation}'`,4:`'${action}'`,
   5:'2',6:'1',7:`'${grant}'`,8:`'sha256:${'c'.repeat(64)}'`,
   9:`'${'a'.repeat(64)}'`,10:"'2099-01-01T00:00:00Z'",11:id
  })[n]);
  const queue=statement({key:'pg-queue-001',grant:'pg-queue-grant',operation:'mcp.queue.submit',action:'repo.inspect'});
  const result=await Promise.all([sql(queue),sql(queue)]);
  assert.equal(result.filter(Boolean).length,1);
  const taskId=await sql("SELECT id FROM brain_tasks WHERE task_key='mcp:pg-queue-001'");
  assert.match(taskId,/^\d+$/);
  assert.equal(await sql("SELECT count(*) FROM brain_events WHERE event_type='mcp-mutation-observed' AND details->>'action_key'='pg-queue-001'"),'1');
  const cancel=statement({key:'pg-control-001',grant:'pg-control-grant',operation:'mcp.task.control',action:'cancel',id:taskId});
  assert.notEqual(await sql(cancel),'');
  assert.equal(await sql(cancel),'');
  assert.equal(await sql(`SELECT status FROM brain_tasks WHERE id=${taskId}`),'canceled');
  await sql('UPDATE brain_runtime_control SET paused=TRUE WHERE id=1');
  assert.equal(await sql(statement({key:'pg-queue-002',grant:'pg-queue-grant-2',
   operation:'mcp.queue.submit',action:'repo.inspect'})),'');
  assert.equal(await sql("SELECT count(*) FROM brain_authority_grants WHERE grant_id='pg-queue-grant-2'"),'0');
 });
}
