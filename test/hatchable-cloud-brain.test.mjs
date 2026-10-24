import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const coreSource = `export const ALLOWED=new Set(['repo.inspect']);
export const CAPABILITIES=[{id:'repo.inspect'}];
export async function executeObjective(objective){return {objective,source:'fixture',sha:'fixed-test-sha'};}`;
const coreUrl='data:text/javascript;base64,'+Buffer.from(coreSource).toString('base64');
async function moduleUnderTest(path,core=coreUrl){
 const source=await readFile(new URL('../cloud/hatchable/lib/'+path,import.meta.url),'utf8');
 const transformed=source.replace("from 'lib/brain-core.js'","from '"+core+"'");
 assert.notEqual(transformed,source,'test import alias should be replaced');
 return import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
}
const {runOne}=await moduleUnderTest('brain-runner.js');
const {queueObjective,controlTask,saveNote}=await moduleUnderTest('brain-owner.js');

function fakeRunnerDb({complete=true,claimed=true,completionReject=false,failureStatus=null}={}){
 const statements=[];
 return {statements,async query(sql,params=[]){
  statements.push({sql,params});
  if(sql.includes("'lease-recovered'")||sql.includes("'attempt-limit'"))return {rows:[]};
  if(sql.includes("'claimed'"))return {rows:claimed?[{id:7,objective:'repo.inspect',attempts:1}]:[]};
  if(sql.includes("'observed'")){
   if(completionReject)throw Error('simulated-completion-write-failure');
   return {rows:complete?[{id:7}]:[]};
  }
  if(sql.includes("'failed'"))return {rows:failureStatus===null?[]:[{id:7,status:failureStatus}]};
  throw Error('unexpected-sql:'+sql.slice(0,80));
 }};
}
test('cloud: successful outcome and its observed receipt form one lease-fenced SQL command',async()=>{
 const db=fakeRunnerDb();
 const result=await runOne({db,browser:{}});
 assert.equal(result.status,'done');
 const commit=db.statements.find(x=>x.sql.includes("'observed'"));
 assert.match(commit.sql,/UPDATE brain_tasks/);
 assert.match(commit.sql,/INSERT INTO brain_events/);
 assert.match(commit.sql,/owner_token=\$3 AND status='leased' AND lease_until>now\(\)/);
 assert.equal(db.statements.filter(x=>x.sql.includes("'failed'")).length,0);
});
test('cloud: stale lease cannot produce a contradictory failure receipt',async()=>{
 const db=fakeRunnerDb({complete:false});
 const result=await runOne({db,browser:{}});
 assert.equal(result.status,'lost-lease');
 assert.equal(db.statements.filter(x=>x.sql.includes("'failed'")).length,0);
});
test('cloud: completion persistence rejection remains uncertain, not an objective failure',async()=>{
 const db=fakeRunnerDb({completionReject:true});
 const result=await runOne({db,browser:{}});
 assert.deepEqual(result,{status:'completion-uncertain',task_id:7,objective:'repo.inspect'});
 assert.equal(db.statements.filter(x=>x.sql.includes("'observed'")).length,1);
 assert.equal(db.statements.filter(x=>x.sql.includes("'failed'")).length,0);
});
test('cloud: uncertain completion does not immediately replay an already claimed objective',async()=>{
 const db=fakeRunnerDb({completionReject:true});
 const query=db.query.bind(db);
 let claims=0;
 db.query=async(sql,params)=>{
  if(sql.includes("'claimed'")&&++claims>1)return {rows:[]};
  return query(sql,params);
 };
 const uncertain=await runOne({db,browser:{}});
 assert.equal(uncertain.status,'completion-uncertain');
 const next=await runOne({db,browser:{}});
 assert.equal(next.status,'idle');
 assert.equal(claims,2);
 assert.equal(db.statements.filter(x=>x.sql.includes("'observed'")).length,1);
 assert.equal(db.statements.filter(x=>x.sql.includes("'failed'")).length,0);
});

test('cloud: real objective execution failure remains lease-fenced and journaled',async()=>{
 const throwingCore=`export const ALLOWED=new Set(['repo.inspect']);
export const CAPABILITIES=[{id:'repo.inspect'}];
export async function executeObjective(){throw Error('real-objective-failure');}`;
 const failingCoreUrl='data:text/javascript;base64,'+Buffer.from(throwingCore).toString('base64');
 const {runOne:runFailing}=await moduleUnderTest('brain-runner.js',failingCoreUrl);
 const db=fakeRunnerDb({failureStatus:'queued'});
 const result=await runFailing({db,browser:{}});
 assert.equal(result.status,'failed');
 assert.equal(result.next_status,'queued');
 assert.match(result.reason,/real-objective-failure/);
 assert.equal(db.statements.filter(x=>x.sql.includes("'observed'")).length,0);
 const failure=db.statements.filter(x=>x.sql.includes("'failed'"));
 assert.equal(failure.length,1);
 assert.match(failure[0].sql,/owner_token=\$2 AND status='leased' AND lease_until>now\(\)/);
});
test('cloud: claim and recovery include their receipts in the same SQL call',async()=>{
 const db=fakeRunnerDb({claimed:false});
 const result=await runOne({db,browser:{}});
 assert.equal(result.status,'idle');
 for(const statement of db.statements) {
  assert.match(statement.sql,/UPDATE brain_tasks/);
  assert.match(statement.sql,/INSERT INTO brain_events/);
 }
});
test('cloud: owner task admission is idempotent and schedules only on insertion',async()=>{
 const statements=[];let scheduled=0;
 const db={async query(sql){
  statements.push(sql);
  if(sql.includes("'owner-queued'")){
   return {rows:statements.filter(s=>s.includes("'owner-queued'")).length===1
    ?[{id:3,task_key:'key-six',objective:'repo.inspect',status:'queued'}]:[]};
  }
  if(sql.includes('WHERE task_key=$1'))return {rows:[{id:3,task_key:'key-six',objective:'repo.inspect',status:'queued'}]};
  throw Error('unexpected-sql');
 }};
 const scheduler={async now(){scheduled++;}};
 const a=await queueObjective({db,scheduler},'repo.inspect','key-six');
 const b=await queueObjective({db,scheduler},'repo.inspect','key-six');
 assert.equal(a.created,true);
 assert.equal(b.created,false);
 assert.equal(scheduled,1);
 assert.match(statements[0],/INSERT INTO brain_events/);
});
test('cloud: unsupported owner objective cannot schedule',async()=>{
 let queries=0;
 const r=await queueObjective({db:{query:async()=>{queries++;}},scheduler:{now:async()=>{}}},'repo.mutate','safe-key');
 assert.equal(r.ok,false);
 assert.equal(queries,0);
});
test('cloud: owner task control updates task and journal atomically',async()=>{
 const statements=[];
 const db={query:async(sql)=>{statements.push(sql);return {rows:[{id:4,status:'canceled'}]};}};
 const r=await controlTask({db},'cancel',4);
 assert.equal(r.ok,true);
 assert.match(statements[0],/UPDATE brain_tasks/);
 assert.match(statements[0],/INSERT INTO brain_events/);
});
test('cloud: private note contents are excluded from the audit receipt',async()=>{
 let sql='';
 const db={query:async(q)=>{sql=q;return {rows:[{id:9,kind:'goal',body:'test-private-note'}]};}};
 const r=await saveNote({db},'goal','test-private-note');
 assert.equal(r.ok,true);
 assert.match(sql,/INSERT INTO brain_notes/);
 assert.match(sql,/INSERT INTO brain_events/);
 assert.match(sql,/jsonb_build_object\('note_id',id,'kind',kind\)/);
 assert.doesNotMatch(sql,/test-private-note/);
});

test('cloud: an expired worker may not requeue a still-owned lease after failure',async()=>{
 const db=fakeRunnerDb({complete:true});
 await runOne({db,browser:{}});
 const updated=await readFile(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
 const failure=updated.slice(updated.indexOf('const failed=await db.query'));
 assert.match(failure,/owner_token=\$2 AND status='leased' AND lease_until>now\(\)/);
});

test('cloud: short hourly tick dispatches slow objective work instead of running it inline',async()=>{
 const tick=await readFile(new URL('../cloud/hatchable/api/brain/tick.js',import.meta.url),'utf8');
 assert.match(tick,/scheduler\.now\('\/api\/brain\/run'/);
 assert.doesNotMatch(tick,/runOne\(/);
 assert.doesNotMatch(tick,/import.*browser.*from 'hatchable'/);
 assert.match(tick,/processed:0/);
});

async function endpointUnderTest(name){
 const source=await readFile(new URL('../cloud/hatchable/api/brain/'+name+'.js',import.meta.url),'utf8');
 const dependency=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
 const platform=dependency('export const db=globalThis.__cloudEndpoint.db; export const browser={}; export const scheduler=globalThis.__cloudEndpoint.scheduler;');
 const runner=dependency('export const runOne=(...args)=>globalThis.__cloudEndpoint.runOne(...args);');
 const transformed=source.replace("from 'hatchable'","from '"+platform+"'")
  .replace("from 'lib/brain-runner.js'","from '"+runner+"'");
 return (await import(dependency(transformed))).default;
}

test('cloud: hourly dispatch recovers expired leases and a full worker batch schedules at most one continuation',async()=>{
 const sql=[];const scheduled=[];let runs=0;
 globalThis.__cloudEndpoint={
  db:{async query(statement){sql.push(statement);return {rows:[{n:1}]};}},
  scheduler:{async now(path,payload){scheduled.push({path,payload});}},
  async runOne(){runs++;return {status:'done'};}
 };
 try{
  const tick=await endpointUnderTest('tick');
  const run=await endpointUnderTest('run');
  const res={json:value=>value};
  const hourly=await tick({},res);
  assert.equal(hourly.continuation_scheduled,true);
  assert.match(sql[1],/status='leased' AND lease_until < now\(\)/);
  assert.equal(runs,0,'hourly tick must leave objective execution to the worker');

  const first=await run({body:{via:'hourly-backlog'}},res);
  assert.equal(first.results.length,4);
  assert.equal(first.continuation_scheduled,true);
  assert.equal(scheduled.length,2);
  assert.deepEqual(scheduled[1],{path:'/api/brain/run',payload:{via:'bounded-continuation'}});

  const queriesBefore=sql.length;
  const second=await run({body:{via:'bounded-continuation'}},res);
  assert.equal(second.results.length,4);
  assert.equal(second.continuation_scheduled,false);
  assert.equal(sql.length,queriesBefore);
  assert.equal(scheduled.length,2);
 }finally{delete globalThis.__cloudEndpoint;}
});

function fakeGithubRetryDb(){
 // A deterministic SQL-driver fixture: models only the status, lease and
 // backoff predicates that the runner must enforce, not a real Postgres server.
 const state={status:'queued',attempts:0,maxAttempts:3,now:0,leaseUntil:0,token:null};
 const events=[],statements=[];
 const db={state,events,statements,advance(ms){state.now+=ms;},
  async query(sql,params=[]){
   statements.push({sql,params});
   if(sql.includes("'lease-recovered'")||sql.includes("'attempt-limit'"))return {rows:[]};
   if(sql.includes("'claimed'")){
    assert.match(sql,/attempts < max_attempts/);
    assert.match(sql,/lease_until IS NULL OR lease_until <= now\(\)/);
    if(state.status!=='queued'||state.attempts>=state.maxAttempts||
       state.leaseUntil>state.now)return {rows:[]};
    state.status='leased';state.attempts++;state.token=params[0];
    state.leaseUntil=state.now+3*60*1000;events.push('claimed');
    return {rows:[{id:37,objective:'repo.inspect',attempts:state.attempts}]};
   }
   if(sql.includes("'failed'")){
    assert.match(sql,/owner_token=\$2 AND status='leased' AND lease_until>now\(\)/);
    assert.match(sql,/interval '15 minutes'/);
    if(state.status!=='leased'||state.token!==params[1]||
       state.leaseUntil<=state.now)return {rows:[]};
    state.status='queued';state.token=null;state.leaseUntil=state.now+15*60*1000;
    events.push('failed');return {rows:[{id:37,status:'queued'}]};
   }
   if(sql.includes("'observed'")){
    assert.match(sql,/owner_token=\$3 AND status='leased' AND lease_until>now\(\)/);
    if(state.status!=='leased'||state.token!==params[2]||
       state.leaseUntil<=state.now)return {rows:[]};
    state.status='done';state.token=null;state.leaseUntil=0;
    events.push('observed');return {rows:[{id:37}]};
   }
   throw Error('unexpected-sql:'+sql.slice(0,80));
  }};
 return db;
}

async function realGithubRunner(){
 const source=await readFile(new URL('../cloud/hatchable/lib/brain-core.js',import.meta.url),'utf8');
 const core='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
 return moduleUnderTest('brain-runner.js',core);
}

test('cloud: GitHub 403 is a lease-fenced failure with bounded retry and later success',async()=>{
 const {runOne:runGithub}=await realGithubRunner();
 const db=fakeGithubRetryDb();
 const originalFetch=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;
  assert.match(String(url),/\/git\/ref\/heads\/main$/);
  assert.equal(options?.signal?.aborted,false);
  if(calls===1)return {ok:false,status:403};
  return {ok:true,json:async()=>({object:{sha:'a'.repeat(40)}})};
 };
 try{
  const failed=await runGithub({db,browser:{}});
  assert.equal(failed.status,'failed');
  assert.equal(failed.reason,'github-status-403');
  assert.equal(failed.next_status,'queued');
  assert.equal(db.state.attempts,1);
  assert.deepEqual(db.events,['claimed','failed']);
  assert.equal(db.statements.filter(x=>x.sql.includes("'observed'")).length,0);
  db.advance(15*60*1000-1);
  const early=await runGithub({db,browser:{}});
  assert.equal(early.status,'idle','must not re-claim during 15-minute backoff');
  assert.equal(calls,1,'must not repeat the failed external read early');
  db.advance(1);
  const recovered=await runGithub({db,browser:{}});
  assert.equal(recovered.status,'done');
  assert.equal(recovered.summary.sha,'a'.repeat(40));
  assert.equal(db.state.attempts,2);
  assert.equal(calls,2);
  assert.deepEqual(db.events,['claimed','failed','claimed','observed']);
 }finally{globalThis.fetch=originalFetch;}
});

test('cloud: GitHub 403 after lease expiry cannot forge a failed or observed receipt',async()=>{
 const {runOne:runGithub}=await realGithubRunner();
 const db=fakeGithubRetryDb();
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{
  db.advance(3*60*1000+1);
  return {ok:false,status:403};
 };
 try{
  const result=await runGithub({db,browser:{}});
  assert.equal(result.status,'lost-lease');
  assert.equal(db.state.attempts,1);
  assert.deepEqual(db.events,['claimed']);
  assert.equal(db.statements.filter(x=>x.sql.includes("'observed'")).length,0);
  assert.equal(db.statements.filter(x=>x.sql.includes("'failed'")).length,1,
   'the fenced failure statement may execute but cannot insert a receipt');
 }finally{globalThis.fetch=originalFetch;}
});
