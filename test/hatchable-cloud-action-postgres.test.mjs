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
  for(const name of ['0001_tasks.sql','0002_events.sql','0003_native_commands.sql',
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
}
