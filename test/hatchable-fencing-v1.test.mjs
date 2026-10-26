import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const runnerFile=new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url);
const migrationFile=new URL('../cloud/hatchable/migrations/0007_cooperative_fencing.sql',import.meta.url);
async function loadRunner(core){
 const source=await readFile(runnerFile,'utf8');
 const encoded='data:text/javascript;base64,'+Buffer.from(core).toString('base64');
 const stop='data:text/javascript;base64,'+Buffer.from(
  "export async function readExecutionControl(){return {paused:false,version:1};}"
 ).toString('base64');
 return import('data:text/javascript;base64,'+Buffer.from(
  source.replace("from 'lib/brain-core.js'","from '"+encoded+"'")
   .replace("from 'lib/runtime-control.js'","from '"+stop+"'")
 ).toString('base64'));
}
const successfulCore=`export async function executeObjective(){return {source:'fixture',objective:'repo.inspect'};}`;
function fakeDatabase({heartbeatRows=1,pausedAtClaim=false}={}){
 const queries=[];
 return {queries,async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.includes("'lease-recovered'")||sql.includes("'attempt-limit'"))return {rows:[]};
  if(sql.includes("'claimed'"))return {rows:pausedAtClaim?[]:[{id:7,task_key:'task-fenced',objective:'repo.inspect',attempts:1,fencing_generation:2}]};
  if(sql.includes("'lease-heartbeat'"))return {rows:heartbeatRows?[{id:7}]:[]};
  if(sql.includes("'observed'"))return {rows:[{id:7}]};
  if(sql.includes("'failed'"))return {rows:[{id:7,status:'queued'}]};
  throw Error('unexpected SQL');
 }};
}

test('a pause committed after the early read prevents a new task claim',async()=>{
 const {runOne}=await loadRunner(`export async function executeObjective(){throw Error('must-not-execute');}`);
 const db=fakeDatabase({pausedAtClaim:true});
 assert.equal((await runOne({db,browser:{}})).status,'idle');
 const claimed=db.queries.find(x=>x.sql.includes("'claimed'"));
 assert.match(claimed.sql,/brain_runtime_control WHERE id=1 FOR SHARE/);
 assert.match(claimed.sql,/AND NOT control\.paused/);
});

test('claim rotates a monotonically increasing fencing generation and creates a 90-second lease',async()=>{
 const {runOne}=await loadRunner(successfulCore),db=fakeDatabase();
 assert.equal((await runOne({db,browser:{}})).status,'done');
 const claimed=db.queries.find(x=>x.sql.includes("'claimed'"));
 assert.match(claimed.sql,/fencing_generation\s*=\s*fencing_generation\s*\+\s*1/);
 assert.match(claimed.sql,/interval '90 seconds'/);
 assert.match(claimed.sql,/RETURNING[^;]*fencing_generation/s);
 const completed=db.queries.find(x=>x.sql.includes("'observed'"));
 assert.match(completed.sql,/fencing_generation=\$[0-9]+/);
 assert.equal(completed.params.includes(2),true);
});

test('heartbeat extends only the current fenced lease and is scheduled while work runs',async()=>{
 const slowCore=`export async function executeObjective(){await new Promise(resolve=>setTimeout(resolve,65));return {source:'fixture'};}`;
 const {runOne}=await loadRunner(slowCore),db=fakeDatabase();
 const out=await runOne({db,browser:{},heartbeatIntervalMs:10});
 assert.equal(out.status,'done');
 const beats=db.queries.filter(x=>x.sql.includes("'lease-heartbeat'"));
 assert.ok(beats.length>=2,'expected periodic heartbeat before the objective finishes');
 for(const b of beats){
  assert.match(b.sql,/owner_token=\$[0-9]+/);
  assert.match(b.sql,/fencing_generation=\$[0-9]+/);
  assert.match(b.sql,/lease_until>now\(\)/);
  assert.match(b.sql,/interval '90 seconds'/);
  assert.equal(b.params.includes(2),true);
 }
});

test('lost heartbeat cannot falsely complete an objective after ownership changes',async()=>{
 const slowCore=`export async function executeObjective(){await new Promise(resolve=>setTimeout(resolve,30));return {source:'fixture'};}`;
 const {runOne}=await loadRunner(slowCore),db=fakeDatabase({heartbeatRows:0});
 const out=await runOne({db,browser:{},heartbeatIntervalMs:5});
 assert.equal(out.status,'lost-lease');
 assert.equal(db.queries.filter(x=>x.sql.includes("'observed'")).length,0);
});

test('failed results and recovered leases remain protected by the fencing generation',async()=>{
 const failingCore=`export async function executeObjective(){throw Error('synthetic-failure');}`;
 const {runOne}=await loadRunner(failingCore),db=fakeDatabase();
 assert.equal((await runOne({db,browser:{}})).status,'failed');
 const failed=db.queries.find(x=>x.sql.includes("'failed'"));
 assert.match(failed.sql,/fencing_generation=\$[0-9]+/);
 assert.equal(failed.params.includes(2),true);
});

test('migration adds nonnegative persistent fencing state without erasing old receipts',async()=>{
 const migration=await readFile(migrationFile,'utf8');
 assert.match(migration,/ALTER TABLE brain_tasks ADD COLUMN IF NOT EXISTS fencing_generation BIGINT/);
 assert.match(migration,/CHECK\s*\(fencing_generation\s*>=\s*0\)/);
 assert.doesNotMatch(migration,/DROP TABLE|TRUNCATE|DELETE FROM brain_events/i);
});
