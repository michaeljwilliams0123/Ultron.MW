import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

import {createPostgresExecutionCorps} from '../src/execution-corps-runtime.mjs';
import {createAutonomousRepairPlan} from '../src/autonomous-repair-loop.mjs';
import {createPostgresAutonomousRepairLedger} from '../src/autonomous-repair-postgres-ledger.mjs';

const base='a'.repeat(40), head='b'.repeat(40), tree='c'.repeat(40);
const repo='michaeljwilliams0123/Ultron.MW', root='/repos/'+repo;
const now=()=>Date.parse('2026-11-26T00:00:00Z');
function plan(){
 return createAutonomousRepairPlan({id:'repair-runtime-001',owner:'michaeljwilliams0123',
  repository:repo,branch:'ultron/repair-runtime-001',baseSha:base,
  objective:'Repair bounded source regression',allowedPaths:['src/example.mjs'],
  maxAttempts:3,maxPaidCents:0,paidFallback:false,expiresAt:'2026-11-27T00:00:00Z'},now());
}
async function fixture(){
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',import.meta.url),'utf8'));
 const p=plan(), calls={write:0,propose:0}, encoded=text=>({encoding:'base64',content:Buffer.from(text).toString('base64')});
 const get=async path=>{
  if(path===root+'/git/ref/heads/'+p.branch)return {ref:'refs/heads/'+p.branch,object:{sha:head}};
  if(path===root+'/git/commits/'+head)return {sha:head,tree:{sha:tree},parents:[{sha:base}]};
  if(path===root+'/compare/'+base+'...'+head)return {total_commits:1,ahead_by:1,behind_by:0,files:[{filename:'src/example.mjs',status:'modified'}]};
  if(path===root+'/contents/src/example.mjs?ref='+base)return encoded('old');
  if(path===root+'/contents/src/example.mjs?ref='+head)return encoded('new');
  throw Error('Unexpected read: '+path);
 };
 const write=async()=>{calls.write++;throw Error('No writes permitted');};
 const repairer={propose:async()=>{calls.propose++;throw Error('No new proposal permitted');}};
 const services={db,repair:{get,post:write,updateRef:write,repairer,authorize:async()=>false,now}};
 return {db,p,calls,services};
}

test('Medic composition requires an explicit trusted repair authorization and PostgreSQL',()=>{
 assert.throws(()=>createPostgresExecutionCorps({repair:{}}),/repair-runtime/);
 assert.throws(()=>createPostgresExecutionCorps({db:{query:async()=>({rows:[]})},repair:{
  get:async()=>{},post:async()=>{},updateRef:async()=>{},repairer:{propose:async()=>{}}
 }}),/repair-runtime/);
});
test('unapproved repair is held in the real PostgreSQL ledger with no provider dispatch',async()=>{
 const f=await fixture();
 try{
  const result=await createPostgresExecutionCorps(f.services).execute({agent:'medic',plan:f.p});
  assert.equal(result.status,'held');
  assert.equal(result.productionAccepted,false);
  assert.equal((await createPostgresAutonomousRepairLedger({db:f.db}).read(f.p.id)).phase,'ready');
  assert.deepEqual(f.calls,{write:0,propose:0});
 }finally{await f.db.close();}
});
test('recreated Medic reconciles a previously dispatched patch through GitHub readback without repeating writes',async()=>{
 const f=await fixture();
 try{
  const ledger=createPostgresAutonomousRepairLedger({db:f.db});
  const p=f.p;
  await ledger.claim(p);
  const manifest={objective:'Fix source',baseSha:base,changes:[{path:'src/example.mjs',before:'old',after:'new'}]};
  const patchDigest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  await ledger.transition({id:p.id,fingerprint:p.fingerprint,from:'ready',to:'patch-dispatched',
   expectedVersion:0,changes:{attempt:1,manifest,patchDigest}});
  const result=await createPostgresExecutionCorps(f.services).execute({agent:'medic',plan:p});
  assert.equal(result.status,'held');
  assert.equal(result.productionAccepted,false);
  const stored=await ledger.read(p.id);
  assert.equal(stored.phase,'applied');
  assert.equal(stored.headSha,head);
  assert.deepEqual(f.calls,{write:0,propose:0});
  const again=await createPostgresExecutionCorps(f.services).execute({agent:'medic',plan:p});
  assert.equal(again.status,'held');
  assert.deepEqual(f.calls,{write:0,propose:0});
 }finally{await f.db.close();}
});

test('Medic rejects malformed service bindings before provider access',()=>{
 const unused=()=>{throw Error('Unexpected provider call');};
 const db={query:unused};
 const repair={get:unused,post:unused,updateRef:unused,repairer:{propose:unused},authorize:unused};
 const invalid=[{db:{} ,repair},{db:null,repair},{db,repair:null},
  {db,repair:{...repair,get:null}},{db,repair:{...repair,post:1}},
  {db,repair:{...repair,updateRef:false}},{db,repair:{...repair,repairer:{propose:'bad'}}},
  {db,repair:{...repair,authorize:'allow'}},{db,repair:{...repair,now:1}},
  {db,repair:{...repair,readFailureTrace:'not-a-function'}}];
 for(const services of invalid)assert.throws(()=>createPostgresExecutionCorps(services),/repair-runtime-trusted-services-required/);
 assert.doesNotThrow(()=>createPostgresExecutionCorps({db,repair}));
});
