import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const runner=await readFile(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
const claim=runner.match(/const claim=await db\.query\(\x60([\s\S]*?)\x60,\[token\]\)/)?.[1];

test('C18 RED: task claim locks durable owner profile and zero-paid authority alongside owner pause',()=>{
 assert.ok(claim,'must test the exact worker-claim SQL, not a reimplementation');
 assert.match(claim,/brain_runtime_control/);
 assert.match(claim,/brain_owner_autonomy_profile/);
 assert.match(claim,/FOR SHARE/);
 assert.match(claim,/autonomy\.max_paid_cents=0/);
 assert.match(claim,/control\.paused/);
 assert.match(claim,/autonomy\.owner='michaeljwilliams0123'/);
});

test('C18 RED: every currently executable read/advisory task has an explicit profile operation mapping',()=>{
 const map={
  'repo.inspect':'repo.inspect',
  'repo.prs':'evidence.read',
  'repo.ci':'evidence.read',
  'site.render':'research.public',
  'council.review':'plan.create'
 };
 for(const [objective,op] of Object.entries(map)){
  assert.ok(claim.includes("WHEN '"+objective+"' THEN autonomy.allowed_operations ? '"+op+"'"),
    objective+' must map to a bounded owner profile operation');
 }
 assert.match(claim,/ELSE FALSE/);
 assert.match(claim,/profile\.allowed_operations|autonomy\.allowed_operations/);
});

test('C18 RED: routine task claim remains fenced, durable, and skip-locked',()=>{
 assert.match(claim,/FOR UPDATE SKIP LOCKED/);
 assert.match(claim,/fencing_generation=fencing_generation\+1/);
 assert.match(claim,/INSERT INTO brain_events/);
 assert.match(claim,/owner_token=\$1/);
 assert.match(claim,/NOT control\.paused/);
});
