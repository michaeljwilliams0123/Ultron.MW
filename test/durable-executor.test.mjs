import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeIdempotentGitHubWrite,inspectGitHubBranch} from '../src/engine/durable-executor.mjs';

const repository='michaeljwilliams0123/Ultron.MW';
const sha='a'.repeat(40), digest='b'.repeat(64);
const context=()=>({taskId:'canary-001',repository,targetBranch:'canary/executor-001',operationDigest:digest});
const persona={role:'steward',authorName:'Ultron Steward'};
const token='example-token-not-real';

// Model PostgreSQL unique keys and atomic WHERE-state transitions for fast tests;
// the optional PGlite tests below execute the actual migration and SQL.
class MemoryDb {
 constructor(){this.rows=new Map();this.queryCalls=[];this.failReceiptOnce=false;}
 async query(sql,params=[]){
  this.queryCalls.push({sql,params});
  if(sql.includes('INSERT INTO github_idempotent_executions')){
   const [id,operationDigest,repo,branch,role]=params;
   if([...this.rows.values()].some(r=>r.targetBranch===branch&&r.idempotencyKey!==id))
    throw Error('branch unique violation');
   if(this.rows.has(id))return {rows:[]};
   const row={idempotencyKey:id,operationDigest,repository:repo,targetBranch:branch,personaRole:role,
    state:'reserved',receipt:null};
   this.rows.set(id,row);return {rows:[{...row}]};
  }
  if(sql.includes('SELECT')&&sql.includes('FROM github_idempotent_executions')){
   const row=this.rows.get(params[0]);return {rows:row?[structuredClone(row)]:[]};
  }
  if(sql.includes("SET state='in_flight'")){
   const row=this.rows.get(params[0]);
   if(row?.state!=='reserved'||row.operationDigest!==params[1])return {rows:[]};
   row.state='in_flight';return {rows:[{idempotency_key:params[0]}]};
  }
  if(sql.includes("SET state='completed'")){
   const row=this.rows.get(params[0]);
   if(this.failReceiptOnce){this.failReceiptOnce=false;throw Error('db disconnected');}
   if(!row||row.operationDigest!==params[1]||row.state==='completed')return {rows:[]};
   row.state='completed';row.receipt=JSON.parse(params[2]);return {rows:[{idempotency_key:params[0]}]};
  }
  if(sql.includes("SET state='reconcile_required'")){
   const row=this.rows.get(params[0]);
   if(['reserved','in_flight'].includes(row?.state))row.state='reconcile_required';
   return {rows:[]};
  }
  throw Error('Unexpected SQL: '+sql);
 }
}
function setup(overrides={}){
 const db=overrides.db??new MemoryDb();
 let state=overrides.remoteState??'absent',writes=0,observations=0,authorizations=0;
 const services={db,clock:()=>Date.parse('2026-11-09T23:00:00Z'),
  authorization:{verify:async intent=>{
   authorizations++;
   return overrides.authorization??{verified:true,operationDigest:intent.operationDigest,
    repository:intent.repository,targetBranch:intent.targetBranch,personaRole:intent.personaRole,
    expiresAt:'2026-11-10T00:00:00Z'};
  }},
  remote:{inspect:async()=>{observations++;
   if(overrides.remoteThrows)throw Error('403');
   return {state,sha:state==='matched'?sha:undefined};
  }}};
 const operation=async args=>{writes++;
  assert.equal(args.operationMarker,'Ultron-Operation-Digest: '+digest);
  if(overrides.operationThrows){state=overrides.effectCommitted?'matched':'absent';throw Error('lost ACK');}
  if(overrides.noEffect){state='absent';return;}
  state='matched';
 };
 return {db,services,operation,get writes(){return writes;},get observations(){return observations;},
  get authorizations(){return authorizations;}};
}
const execute=h=>executeIdempotentGitHubWrite(context(),token,persona,h.operation,h.services);

test('one authorized write is independently verified, durably stored and reused',async()=>{
 const h=setup(),first=await execute(h),second=await execute(h);
 assert.equal(first.status,'success');assert.equal(first.idempotencyKey,'ultron-task-canary-001');
 assert.equal(first.details.sha,sha);assert.equal(first.details.remoteVerified,true);
 assert.deepEqual(second,first);assert.equal(h.writes,1);
 assert.equal(h.db.rows.get(first.idempotencyKey).state,'completed');
 assert.equal(JSON.stringify(first).includes(token),false);
});
test('concurrent identical dispatches never invoke two mutations',async()=>{
 const h=setup();const [one,two]=await Promise.all([execute(h),execute(h)]);
 assert.equal(h.writes,1);
 assert.deepEqual([one.status,two.status].sort(),['reconcile_required','success']);
});
test('existing matching operation marker reconciles without dispatch',async()=>{
 const h=setup({remoteState:'matched'}),receipt=await execute(h);
 assert.equal(receipt.status,'reconciled_success');assert.equal(h.writes,0);
});
test('remote branch with another operation marker is conflict, not success',async()=>{
 const h=setup({remoteState:'conflict'}),result=await execute(h);
 assert.equal(result.status,'reconcile_required');assert.equal(h.writes,0);
 assert.equal(h.db.rows.get(result.idempotencyKey).state,'reconcile_required');
});
test('ambiguous lost ACK plus successful remote readback recovers without replay',async()=>{
 const h=setup({operationThrows:true,effectCommitted:true}),receipt=await execute(h);
 assert.equal(receipt.status,'success');assert.equal(h.writes,1);
});
test('unknown write never retries automatically after restart',async()=>{
 const h=setup({operationThrows:true,effectCommitted:false});
 const one=await execute(h),two=await execute(h);
 assert.equal(one.status,'reconcile_required');assert.equal(two.status,'reconcile_required');
 assert.equal(h.writes,1);
});
test('readback errors are not mistaken for absent branch',async()=>{
 const h=setup({remoteThrows:true}),result=await execute(h);
 assert.equal(result.status,'reconcile_required');assert.equal(h.writes,0);
});
test('callback returning without a remote effect cannot yield a success receipt',async()=>{
 const h=setup({noEffect:true}),result=await execute(h);
 assert.equal(result.status,'reconcile_required');assert.equal(h.writes,1);
});
test('same key with changed operation digest is rejected without write',async()=>{
 const h=setup();await execute(h);const changed={...context(),operationDigest:'c'.repeat(64)};
 await assert.rejects(executeIdempotentGitHubWrite(changed,token,persona,h.operation,
  {...h.services,authorization:{verify:async intent=>({verified:true,operationDigest:intent.operationDigest,
   repository:intent.repository,targetBranch:intent.targetBranch,personaRole:intent.personaRole,
   expiresAt:'2026-11-10T00:00:00Z'})}}),/intent-conflict/);
 assert.equal(h.writes,1);
});
test('missing trusted authorization or wrong expiry rejects before DB claim',async()=>{
 const h=setup({authorization:{verified:true,operationDigest:digest,repository,
  targetBranch:context().targetBranch,personaRole:'steward',expiresAt:'2026-11-09T22:00:00Z'}});
 await assert.rejects(execute(h),/authorization-rejected/);
 assert.equal(h.db.rows.size,0);
 await assert.rejects(executeIdempotentGitHubWrite(context(),token,persona,h.operation,{db:h.db}),
  /trusted-adapters-required/);
});
test('invalid scope, persona, branch, or accessors fail closed',async()=>{
 const h=setup();
 for(const patch of [{repository:'other/repo'},{targetBranch:'main'},
  {targetBranch:'canary/unsafe..branch'},{operationDigest:'invalid'}]){
  await assert.rejects(executeIdempotentGitHubWrite({...context(),...patch},token,persona,
   h.operation,h.services),/invalid-context/);
 }
 await assert.rejects(executeIdempotentGitHubWrite(context(),token,{role:'unknown'},
  h.operation,h.services),/invalid-context/);
 const accessor={...context()};Object.defineProperty(accessor,'targetBranch',{get(){return 'canary/executor-001';}});
 await assert.rejects(executeIdempotentGitHubWrite(accessor,token,persona,h.operation,
  h.services),/invalid-context/);
 assert.equal(h.writes,0);
});
test('commit/readback persistence failures cannot report success',async()=>{
 const db=new MemoryDb();db.failReceiptOnce=true;
 const h=setup({db});
 await assert.rejects(execute(h),/receipt-persistence-unverified/);
 assert.equal(h.writes,1);
 const recovered=await execute(h);
 assert.equal(recovered.status,'recovered_success');assert.equal(h.writes,1);
});
test('GitHub readback distinguishes exact commit trailer, conflict, absence and 403',async()=>{
 const expected={...context()},calls=[];
 const fetchImpl=async (url,options)=>{
  calls.push(url);
  assert.equal(options.headers.Authorization,`Bearer ${token}`);
  if(url.includes('/git/ref/'))return {ok:true,status:200,json:async()=>({object:{type:'commit',sha}})};
  return {ok:true,status:200,json:async()=>({message:`Fix\n\nUltron-Operation-Digest: ${digest}`})};
 };
 const match=await inspectGitHubBranch(token,expected,{fetchImpl});
 assert.deepEqual(match,{state:'matched',sha});assert.equal(calls.length,3);
 const conflict=await inspectGitHubBranch(token,expected,{fetchImpl:async url=>({ok:true,status:200,
  json:async()=>url.includes('/git/ref/')?{object:{type:'commit',sha}}:{message:'unrelated'}})});
 assert.equal(conflict.state,'conflict');
 assert.deepEqual(await inspectGitHubBranch(token,expected,{fetchImpl:async()=>({status:404,ok:false})}),{state:'absent'});
 await assert.rejects(inspectGitHubBranch(token,expected,{fetchImpl:async()=>({status:403,ok:false})}),
  /github-readback-unavailable/);
});


test('remote branch movement between commit and ref readback is not verification',async()=>{
 let reads=0;
 const moved='c'.repeat(40);
 const result=await inspectGitHubBranch(token,context(),{fetchImpl:async url=>{
  if(url.includes('/git/ref/')){
   reads++;
   return {ok:true,status:200,json:async()=>({object:{type:'commit',sha:reads===1?sha:moved}})};
  }
  return {ok:true,status:200,json:async()=>({message:'Commit\n\nUltron-Operation-Digest: '+digest})};
 }});
 assert.equal(result.state,'conflict');
 assert.equal(reads,2,'the same ref must be sampled after fetching commit');
});
test('lost ACK after durable reconciliation update is confirmed by fresh SELECT',async()=>{
 class LostAckDb extends MemoryDb{
  async query(sql,params){
   if(sql.includes("SET state='reconcile_required'")){
    await super.query(sql,params);
    throw Error('lost ACK after commit');
   }
   return super.query(sql,params);
  }
 }
 const h=setup({db:new LostAckDb(),remoteState:'conflict'});
 const result=await execute(h);
 assert.equal(result.status,'reconcile_required');
 assert.equal(h.db.rows.get(result.idempotencyKey).state,'reconcile_required');
 assert.equal(h.writes,0);
});
test('persona attribution is fixed by the verified role, not caller-mutable fields',async()=>{
 const h=setup();
 let passedPersona;
 const supplied={role:'steward',authorName:'Untrusted Admin',extra:'surprise'};
 const result=await executeIdempotentGitHubWrite(context(),token,supplied,
  async args=>{passedPersona=args.persona;await h.operation(args);},h.services);
 assert.equal(result.status,'success');
 assert.deepEqual(passedPersona,{role:'steward',authorName:'Ultron.MW [Steward]',
  authorEmail:'ultron-mw-steward@system.local'});
 assert.equal(Object.isFrozen(passedPersona),true);
});

let PGlite=null;
try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
const skip=PGlite?false:'@electric-sql/pglite unavailable';
const migration=readFileSync(new URL('../cloud/hatchable/migrations/0039_github_idempotent_executions.sql',import.meta.url),'utf8');
test('PGlite: real migration, durable duplicate recovery and immutable terminal receipts',{skip},async()=>{
 const db=new PGlite();await db.exec(migration);
 const h=setup({db}),first=await execute(h),second=await execute(h);
 assert.equal(first.status,'success');assert.deepEqual(second,first);assert.equal(h.writes,1);
 await assert.rejects(db.query('DELETE FROM github_idempotent_executions'),/immutable/);
 await assert.rejects(db.query("UPDATE github_idempotent_executions SET state='reconcile_required'"),
  /completed-immutable/);
 await db.close();
});

test('PGlite: incomplete JSON receipts cannot bypass SQL CHECK through NULL',{skip},async()=>{
 const db=new PGlite();await db.exec(migration);
 await assert.rejects(db.query(`INSERT INTO github_idempotent_executions
  (idempotency_key,operation_digest,repository,target_branch,persona_role,state,receipt)
  VALUES ($1,$2,$3,$4,$5,'completed',$6::jsonb)`,
 ['ultron-task-invalid-001',digest,repository,'canary/invalid-receipt','steward',
  JSON.stringify({idempotencyKey:'ultron-task-invalid-001',details:{branch:'canary/invalid-receipt',
   repository,operationDigest:digest,sha,remoteVerified:true}})]),/check constraint|violates/i);
 await db.close();
});
test('PGlite: competing claims use real unique constraints and cannot double-write',{skip},async()=>{
 const db=new PGlite();await db.exec(migration);
 const h=setup({db}),results=await Promise.all([execute(h),execute(h)]);
 assert.equal(h.writes,1);
 assert.equal(results.some(r=>r.status==='success'),true);
 await db.close();
});

test('Task 2 persona handoff preserves safe commit author identity for the conductor',async()=>{
 const h=setup();
 let passedPersona;
 const spoofed={role:'builder',authorName:'Malicious Admin',
  authorEmail:'attacker@invalid.example'};
 const receipt=await executeIdempotentGitHubWrite(context(),token,spoofed,
  async args=>{passedPersona=args.persona;await h.operation(args);},h.services);
 assert.equal(receipt.status,'success');
 assert.deepEqual(passedPersona,{
  role:'builder',authorName:'Ultron.MW [Builder]',
  authorEmail:'ultron-mw-builder@system.local'
 });
 assert.equal(Object.isFrozen(passedPersona),true);
});


test('crash before dispatch: an existing reserved row can be atomically claimed by replacement worker',async()=>{
 const h=setup(),c=context();
 h.db.rows.set(`ultron-task-${c.taskId}`,{
  idempotencyKey:`ultron-task-${c.taskId}`,operationDigest:digest,repository,
  targetBranch:c.targetBranch,personaRole:'steward',state:'reserved',receipt:null
 });
 const result=await execute(h);
 assert.equal(result.status,'success');
 assert.equal(h.writes,1);
 assert.equal(h.db.rows.get(result.idempotencyKey).state,'completed');
});

test('concurrent recovery from reserved state uses CAS to dispatch exactly once',async()=>{
 const h=setup(),c=context();
 h.db.rows.set(`ultron-task-${c.taskId}`,{
  idempotencyKey:`ultron-task-${c.taskId}`,operationDigest:digest,repository,
  targetBranch:c.targetBranch,personaRole:'steward',state:'reserved',receipt:null
 });
 const results=await Promise.all([execute(h),execute(h),execute(h)]);
 assert.equal(h.writes,1);
 assert.equal(results.filter(r=>r.status==='success').length,1);
});

test('lost acknowledgement after INSERT is recovered from durable SELECT without duplicate dispatch',async()=>{
 class LostInsertAckDb extends MemoryDb{
  async query(sql,params){
   if(sql.includes('INSERT INTO github_idempotent_executions')){
    await super.query(sql,params);
    throw Error('insert committed but acknowledgement lost');
   }
   return super.query(sql,params);
  }
 }
 const h=setup({db:new LostInsertAckDb()});
 const result=await execute(h);
 assert.equal(result.status,'success');
 assert.equal(h.writes,1);
});

test('duplicate in_flight attempt does not mutate or replace active claim',async()=>{
 const h=setup(),c=context();
 h.db.rows.set(`ultron-task-${c.taskId}`,{
  idempotencyKey:`ultron-task-${c.taskId}`,operationDigest:digest,repository,
  targetBranch:c.targetBranch,personaRole:'steward',state:'in_flight',receipt:null
 });
 const result=await execute(h);
 assert.equal(result.status,'reconcile_required');
 assert.equal(h.writes,0);
 assert.equal(h.db.rows.get(result.idempotencyKey).state,'in_flight');
});

test('GitHub reads use an AbortSignal so stalled readback cannot hang a worker indefinitely',async()=>{
 const calls=[];
 await inspectGitHubBranch(token,context(),{fetchImpl:async (url,options)=>{
  calls.push(options.signal);
  return {status:404,ok:false};
 }});
 assert.equal(calls.length,1);
 assert.equal(calls[0] instanceof AbortSignal,true);
});

test('PGlite: crashed pre-dispatch reservation can resume once under concurrent workers',{skip},async()=>{
 const db=new PGlite();await db.exec(migration);
 const c=context();
 await db.query(`INSERT INTO github_idempotent_executions
  (idempotency_key,operation_digest,repository,target_branch,persona_role,state)
  VALUES ($1,$2,$3,$4,$5,'reserved')`,
  [`ultron-task-${c.taskId}`,c.operationDigest,c.repository,c.targetBranch,'steward']);
 const h=setup({db}),results=await Promise.all([execute(h),execute(h),execute(h)]);
 assert.equal(h.writes,1);
 assert.equal(results.some(r=>r.status==='success'),true);
 const stored=await db.query('SELECT state FROM github_idempotent_executions WHERE idempotency_key=$1',
  [`ultron-task-${c.taskId}`]);
 assert.equal(stored.rows[0].state,'completed');
 await db.close();
});
