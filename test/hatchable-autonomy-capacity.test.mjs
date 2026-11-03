import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../cloud/hatchable/',import.meta.url);
const runner=await readFile(new URL('lib/brain-runner.js',root),'utf8');
const run=await readFile(new URL('api/brain/run.js',root),'utf8');
const claim=runner.match(/const claim=await db\.query\(`([\s\S]*?)`,\[token\]\)/)?.[1];

test('C18 RED: task claims lock owner capacity row before atomic lease admission',()=>{
  assert.ok(claim);
  assert.match(claim,/brain_owner_autonomy_profile/);
  assert.match(claim,/version AS profile_version/);
  assert.match(claim,/FROM brain_owner_autonomy_profile WHERE id=1 FOR UPDATE/);
  assert.match(claim,/FOR UPDATE SKIP LOCKED/);
});
test('C18 RED: persisted capacity trigger prevents excess concurrent leased tasks',async()=>{
  const sql=await readFile(new URL('migrations/0017_owner_autonomy_capacity.sql',root),'utf8');
  assert.match(sql,/ADD COLUMN IF NOT EXISTS active_leases/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION autonomy_task_capacity/);
  assert.match(sql,/BEFORE INSERT OR UPDATE OF status ON brain_tasks/);
  assert.match(sql,/active_leases=active_leases\+1/);
  assert.match(sql,/active_leases=active_leases-1/);
  assert.match(sql,/RETURN NULL/);
});
test('C18 RED: scheduled processing obeys owner step cap and an absolute safe limit',()=>{
  assert.match(run,/readOwnerProfile/);
  assert.match(run,/Math\.min\(8,profile\.limits\.maxSteps\)/);
  assert.match(run,/for\(let i=0;i<batchLimit;i\+\+\)/);
  assert.match(run,/results\.length===batchLimit/);
});
