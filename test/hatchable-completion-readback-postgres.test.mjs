// Ephemeral CI PostgreSQL test: verifies actual completion-reconciliation SQL.
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
 assert.equal(containers.length,1,'exactly one ephemeral PostgreSQL service');
 const client=['exec',containers[0],'psql','-U','ultron','-d','ultron',
  '-X','-q','-t','-A','-v','ON_ERROR_STOP=1'];
 const sql=async statement=>{
  const {stdout}=await run('docker',[...client,'-c',statement]);
  return stdout.trim();
 };
 const source=readFileSync(new URL('../cloud/hatchable/lib/brain-runner.js',
  import.meta.url),'utf8');
 const readback=source.match(/const observed=await db\.query\(\x60([\s\S]*?)\x60,\s*\[task\.id,task\.fencing_generation,JSON\.stringify\(result\),task\.objective\]\)/)?.[1];
 assert.ok(readback,'use the exact SQL from the fenced completion response-loss path');
 const schema='ultron_completion_readback_ci';
 const scoped=s=>'SET search_path TO '+schema+'; '+s;
 const migration=name=>readFileSync(new URL('../cloud/hatchable/migrations/'+name,
  import.meta.url),'utf8');
 test('real PostgreSQL accepts only exact committed fenced task and observed receipt',async()=>{
  await sql('DROP SCHEMA IF EXISTS '+schema+' CASCADE; CREATE SCHEMA '+schema+';');
  for(const f of ['0001_tasks.sql','0002_events.sql','0007_cooperative_fencing.sql'])
   await sql(scoped(migration(f)));
  const result='{"source":"fixture","objective":"repo.inspect"}';
  const id=Number(await sql(scoped(
   "INSERT INTO brain_tasks(task_key,objective,status,last_result,fencing_generation) VALUES "+
   "('issue66-committed','repo.inspect','done','"+result+"'::jsonb,7) RETURNING id")));
  assert.ok(id>0);
  await sql(scoped("INSERT INTO brain_events(task_id,event_type,details) VALUES ("+
   id+",'observed','{\"objective\":\"repo.inspect\",\"source\":\"fixture\",\"fencingGeneration\":7}'::jsonb)"));
  const check=async({fence=7,actualResult=result,objective='repo.inspect'}={})=>{
   const literals=[String(id),String(fence),"'"+actualResult+"'","'"+objective+"'"];
   const query=readback.replace(/\$([1-4])\b/g,(_all,n)=>literals[Number(n)-1]);
   return await sql(scoped(query));
  };
  assert.equal(await check(),String(id));
  assert.equal(await check({fence:8}),'','stale generation denied');
  assert.equal(await check({actualResult:'{"source":"tampered"}'}),'','wrong result denied');
  assert.equal(await check({objective:'repo.prs'}),'','wrong objective denied');
  await sql(scoped("UPDATE brain_events SET details=jsonb_set(details,'{fencingGeneration}','8'::jsonb) WHERE task_id="+id));
  assert.equal(await check(),'','wrong receipt fence denied');
  await sql(scoped("UPDATE brain_events SET details=jsonb_set(details,'{fencingGeneration}','7'::jsonb) WHERE task_id="+id));
  await sql(scoped("UPDATE brain_tasks SET status='leased' WHERE id="+id));
  assert.equal(await check(),'','uncommitted task denied');
  await sql(scoped("UPDATE brain_tasks SET status='done' WHERE id="+id));
  await sql(scoped("DELETE FROM brain_events WHERE task_id="+id));
  assert.equal(await check(),'','missing observed receipt denied');
 });
}
