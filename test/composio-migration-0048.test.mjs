import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=new URL('../cloud/hatchable/migrations/',import.meta.url);
const read=async name=>readFile(new URL(name,base),'utf8');
test('duplicate historical 0039 numeric prefix is grandfathered, not renamed',async()=>{
 const a=await read('0039_autonomous_repair_checkpoints.sql');
 const b=await read('0039_github_idempotent_executions.sql');
 assert.match(a,/CREATE TABLE IF NOT EXISTS brain_autonomous_repairs/);
 assert.match(b,/CREATE TABLE IF NOT EXISTS github_idempotent_executions/);
 assert.doesNotMatch(a,/DROP TABLE/);assert.doesNotMatch(b,/DROP TABLE/);
});
test('0048 stores only references with immutable canonical GitHub owners',async()=>{
 const sql=await read('0048_composio_sessions.sql');
 for(const name of ['brain_composio_principals','brain_composio_sessions','brain_composio_read_receipts'])
  assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS '+name));
 assert.match(sql,/github_user_id=308995719/);
 assert.match(sql,/github_user_id=354634860/);
 assert.match(sql,/CHECK \(connection_state<>'active'/);
 assert.doesNotMatch(sql,/CREATE TABLE.*(access_token|refresh_token|private_key)/i);
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|ALTER TABLE brain_/);
});
test('0048 bootstrap and duplicated 0039 files execute in PostgreSQL dialect',async t=>{
 let PGlite;try{({PGlite}=await import('@electric-sql/pglite'));}catch{
   t.skip('PGlite dependency not installed in isolated fast smoke');return;
 }
 const db=new PGlite();
 try{
  for(const f of ['0039_autonomous_repair_checkpoints.sql',
   '0039_github_idempotent_executions.sql','0048_composio_sessions.sql'])
   await db.exec(await read(f));
  await db.exec(await read('0048_composio_sessions.sql'));
  const {rows}=await db.query('SELECT principal_key,connection_state FROM brain_composio_principals ORDER BY principal_key');
  assert.deepEqual(rows.map(x=>x.principal_key),['mw-primary','ultron-admin']);
  assert.ok(rows.every(x=>x.connection_state==='pending'));
  await assert.rejects(db.query("INSERT INTO brain_composio_principals(principal_key,github_login,github_user_id) VALUES ('evil','evil',2)"));
  await assert.rejects(db.query("UPDATE brain_composio_principals SET connection_state='active' WHERE principal_key='ultron-admin'"));
  const {rows:tables}=await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('brain_autonomous_repairs','github_idempotent_executions','brain_composio_sessions')");
  assert.equal(tables.length,3);
 }finally{await db.close();}
});
