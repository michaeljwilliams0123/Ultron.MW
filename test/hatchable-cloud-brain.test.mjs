import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const coreSource = `export const ALLOWED=new Set(['repo.inspect']);
export const CAPABILITIES=[{id:'repo.inspect'}];
export async function executeObjective(objective){return {objective,source:'fixture',sha:'fixed-test-sha'};}`;
const coreUrl='data:text/javascript;base64,'+Buffer.from(coreSource).toString('base64');
async function moduleUnderTest(path){
 const source=await readFile(new URL('../cloud/hatchable/lib/'+path,import.meta.url),'utf8');
 const transformed=source.replace("from 'lib/brain-core.js'","from '"+coreUrl+"'");
 assert.notEqual(transformed,source,'test import alias should be replaced');
 return import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
}
const {runOne}=await moduleUnderTest('brain-runner.js');
const {queueObjective,controlTask,saveNote}=await moduleUnderTest('brain-owner.js');

function fakeRunnerDb({complete=true,claimed=true}={}){
 const statements=[];
 return {statements,async query(sql,params=[]){
  statements.push({sql,params});
  if(sql.includes("'lease-recovered'")||sql.includes("'attempt-limit'"))return {rows:[]};
  if(sql.includes("'claimed'"))return {rows:claimed?[{id:7,objective:'repo.inspect',attempts:1}]:[]};
  if(sql.includes("'observed'"))return {rows:complete?[{id:7}]:[]};
  if(sql.includes("'failed'"))return {rows:[]};
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
