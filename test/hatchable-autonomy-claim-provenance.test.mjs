import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const runner=await readFile(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
const claim=runner.match(/const claim=await db\.query\(`([\s\S]*?)`,\[token\]\)/)?.[1];

test('C18 RED: durable claim records the exact profile and stop revisions observed at admission',()=>{
 assert.ok(claim,'extract actual SQL used in cloud executor');
 assert.match(claim,/SELECT paused,version AS stop_version\b/);
 assert.match(claim,/max_paid_cents,\s*version AS profile_version\b/);
 assert.match(claim,/autonomy\.profile_version/);
 assert.match(claim,/control\.stop_version/);
 assert.match(claim,/jsonb_build_object\('objective',objective,'attempt',attempts,'profileVersion'/);
 assert.match(claim,/'stopVersion'/);
 assert.match(claim,/FROM moved JOIN selected ON selected\.id=moved\.id/);
});

test('C18 RED: claim event retains objective and attempt plus versioned immutable admission',()=>{
 assert.match(claim,/INSERT INTO brain_events\(task_id,event_type,details\)/);
 assert.match(claim,/'claimed'/);
 assert.match(claim,/FOR SHARE/);
 assert.match(claim,/FOR UPDATE SKIP LOCKED/);
 assert.match(claim,/autonomy\.max_paid_cents=0/);
 assert.match(claim,/NOT control\.paused/);
 assert.match(claim,/ELSE FALSE/);
});
