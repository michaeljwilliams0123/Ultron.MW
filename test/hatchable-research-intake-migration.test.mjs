import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=readFileSync(new URL('../cloud/hatchable/migrations/0035_research_observations.sql',import.meta.url),'utf8');
async function setup(){
 const db=new PGlite();
 await db.exec('CREATE TABLE brain_tasks(id BIGSERIAL PRIMARY KEY,task_key TEXT UNIQUE,objective TEXT NOT NULL);');
 await db.exec(sql);
 const task=await db.query("INSERT INTO brain_tasks(task_key,objective) VALUES('research-slot-1','research.intake') RETURNING id");
 return {db,taskId:task.rows[0].id};
}
test('research candidate ledger dedupes changed upstream versions across scheduler runs',async()=>{
 const {db,taskId}=await setup();
 try{
  const add=async(version,task=taskId)=>db.query(
   'INSERT INTO brain_research_observations(repository,version,pinned_version,source_url,published_at,priority,first_task_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(repository,version,pinned_version) DO NOTHING RETURNING repository',
   ['actions/upload-artifact',version,'v4.6.2',
    'https://github.com/actions/upload-artifact/releases/tag/'+version,
    '2026-10-07T10:08:14Z',70,task]);
  assert.equal((await add('v7.0.2')).rows.length,1);
  const other=await db.query("INSERT INTO brain_tasks(task_key,objective) VALUES('research-slot-2','research.intake') RETURNING id");
  assert.equal((await add('v7.0.2',other.rows[0].id)).rows.length,0);
  assert.equal((await add('v7.0.3',other.rows[0].id)).rows.length,1);
  const rows=(await db.query('SELECT repository,version,first_task_id,cost_cents FROM brain_research_observations ORDER BY version')).rows;
  assert.deepEqual(rows.map(x=>x.version),['v7.0.2','v7.0.3']);
  assert.deepEqual(rows.map(x=>x.cost_cents),[0,0]);
 }finally{await db.close()}
});
test('research ledger rejects paid or spoofed source rows',async()=>{
 const {db,taskId}=await setup();
 try{
  await assert.rejects(db.query('INSERT INTO brain_research_observations(repository,version,pinned_version,source_url,published_at,priority,cost_cents,first_task_id) VALUES($1,$2,$3,$4,now(),70,1,$5)',
   ['actions/checkout','v7.0.2','v7.0.1','https://github.com/actions/checkout/releases/tag/v7.0.2',taskId]),/check constraint/i);
  await assert.rejects(db.query('INSERT INTO brain_research_observations(repository,version,pinned_version,source_url,published_at,priority,first_task_id) VALUES($1,$2,$3,$4,now(),70,$5)',
   ['actions/checkout','v7.0.2','v7.0.1','http://evil.invalid/release',taskId]),/check constraint/i);
  assert.equal((await db.query('SELECT count(*)::int n FROM brain_research_observations')).rows[0].n,0);
 }finally{await db.close()}
});
