import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 validDeskKeys,shapeTask,shapeNote,collectActionDeskState
} from '../cloud/hatchable/lib/action-desk-readback.js';

const root=new URL('../cloud/hatchable/',import.meta.url);
const sha='c'.repeat(40);
const owned={owner:'michaeljwilliams0123',preset:'release',version:7,
 max_paid_cents:0,allowed_operations:['repo.inspect','cloud.note.create']};
const unpaused={paused:false,version:5};
const goodTask={id:5267,task_key:'desk-12345678',objective:'repo.inspect',
 status:'done',receipt_id:3774,last_result:{objective:'repo.inspect',
 repository:'michaeljwilliams0123/Ultron.MW',source:'github-api',sha},
 updated_at:'2026-11-19T14:29:13Z'};
const goodNote={id:200,kind:'observation',fingerprint:'a'.repeat(64),
 receipt_id:3775,receipt_count:1};
const fixture=(override={})=>{
 const calls=[];
 return {calls,query:async(sql,params)=>{
  calls.push({sql,params});
  assert.match(sql,/^SELECT /,'GET must never mutate the database');
  if(sql.includes('FROM brain_owner_autonomy_profile'))return {rows:[override.profile||owned]};
  if(sql.includes('FROM brain_runtime_control'))return {rows:[override.control||unpaused]};
  if(sql.includes('FROM brain_tasks t'))return {rows:override.tasks??[goodTask]};
  if(sql.includes('FROM brain_notes n'))return {rows:override.notes??[goodNote]};
  throw Error('unknown-query');
 }};
};

test('action keys are exact, bounded and do not accept arbitrary provider payloads',()=>{
 assert.equal(validDeskKeys({}),true);
 assert.equal(validDeskKeys({taskKey:'desk-12345678',actionKey:'desk.note:12345678'}),true);
 for(const query of [{taskKey:'../secrets'},{taskKey:['desk-12345678']},
  {actionKey:'ghp_sensitive'},{actionKey:'x'},{taskKey:'a'.repeat(90)},
  {actionKey:'newlines\nunsafe'}])assert.equal(validDeskKeys(query),false);
});

test('missing or ambiguous receipts never become observed success',()=>{
 assert.equal(shapeTask({...goodTask,receipt_id:null}).verification,'reconcile-required');
 assert.equal(shapeTask({...goodTask,receipt_id:0}).verification,'reconcile-required');
 assert.equal(shapeTask({...goodTask,last_result:{...goodTask.last_result,sha:'x'.repeat(40)}}).verification,'reconcile-required');
 assert.equal(shapeTask({...goodTask,last_result:{...goodTask.last_result,repository:'attacker/repo'}}).verification,'reconcile-required');
 assert.equal(shapeTask({...goodTask,status:'queued'}).verification,'awaiting-terminal-result');
 assert.equal(shapeTask(goodTask).verification,'task-result-persisted');
 assert.equal(shapeNote([{...goodNote,receipt_id:null}]).status,'reconcile-required');
 assert.equal(shapeNote([{...goodNote,receipt_count:2}]).status,'reconcile-required');
 assert.equal(shapeNote([goodNote,goodNote]).status,'reconcile-required');
 assert.equal(shapeNote([goodNote]).verification,'note-and-receipt-persisted');
});

test('owner state is read-only and binds completed observations to independent ledger rows',async()=>{
 const db=fixture();
 const value=await collectActionDeskState({db,taskKey:'desk-12345678',actionKey:'desk.note:12345678'});
 assert.equal(value.ok,true);
 assert.equal(value.authority.preset,'release');
 assert.equal(value.authority.paused,false);
 assert.equal(value.authority.paidCeilingCents,0);
 assert.equal(value.authority.noteAllowed,true);
 assert.equal(value.task.receiptId,3774);
 assert.equal(value.task.sourceSha,sha);
 assert.equal(value.note.receiptId,3775);
 assert.equal(value.note.noteId,200);
 assert.equal(db.calls.length,4);
 assert.deepEqual(db.calls.at(-1).params,['desk.note:12345678']);
 assert.equal(JSON.stringify(value).includes(goodNote.fingerprint),false);
});

test('pause, unauthorized owner, paid ceiling or denied operation holds admission',async()=>{
 for(const input of [
  {control:{paused:true,version:6}},
  {profile:{...owned,owner:'unexpected-owner'}},
  {profile:{...owned,max_paid_cents:25}},
  {profile:{...owned,allowed_operations:[]}},
  {profile:{...owned,preset:'observe'}}
 ]){
  const value=await collectActionDeskState({db:fixture(input)});
  assert.equal(value.authority.noteAllowed,false);
  if(input.control||input.profile?.allowed_operations||input.profile?.max_paid_cents||
   input.profile?.owner)assert.equal(value.authority.inspectionAllowed,false);
 }
});

test('invalid query parameters fail before any database access',async()=>{
 const db=fixture();
 await assert.rejects(()=>collectActionDeskState({db,taskKey:'../../.env'}),/key-invalid/);
 assert.equal(db.calls.length,0);
});

function response(){
 return {code:200,headers:{},status(v){this.code=v;return this;},
  setHeader(k,v){this.headers[k]=v;},
  json(body){return {status:this.code,headers:this.headers,body}}};
}
async function route(db){
 globalThis.__actionDeskTestDb=db;
 const source=await readFile(new URL('api/brain/action-desk.js',root),'utf8');
 const native=source.replace("import {db} from 'hatchable';",
  'const db=globalThis.__actionDeskTestDb;')
  .replace("from 'lib/action-desk-readback.js';",
   "from '"+new URL('lib/action-desk-readback.js',root).href+"';");
 assert.notEqual(native,source);
 return import('data:text/javascript;base64,'+Buffer.from(native).toString('base64')+'#'+Math.random());
}

test('API denies nonowner, rejects arbitrary POST and invalid keys without query',async()=>{
 const db=fixture(),r=await route(db);
 assert.equal(r.access,'admin');
 assert.deepEqual(r.methods,['GET']);
 const denied=await r.default({method:'GET',member:{handle:'not-owner'},query:{}},response());
 assert.equal(denied.status,403);
 const post=await r.default({method:'POST',member:{handle:'michaeljwilliams0123'},query:{}},response());
 assert.equal(post.status,405);
 const invalid=await r.default({method:'GET',member:{handle:'michaeljwilliams0123'},
  query:{taskKey:'../../.env'}},response());
 assert.equal(invalid.status,400);
 assert.equal(db.calls.length,0);
 delete globalThis.__actionDeskTestDb;
});

test('API owner read returns exact persisted results with no-store cache',async()=>{
 const db=fixture(),r=await route(db);
 const out=await r.default({method:'GET',member:{handle:'michaeljwilliams0123'},
  query:{taskKey:'desk-12345678',actionKey:'desk.note:12345678'}},response());
 assert.equal(out.status,200);
 assert.equal(out.body.task.verification,'task-result-persisted');
 assert.equal(out.body.note.verification,'note-and-receipt-persisted');
 assert.equal(out.headers['cache-control'],'private, no-store');
 delete globalThis.__actionDeskTestDb;
});

test('Council UI provides explicit owner confirmation and no generic external executor',async()=>{
 const [html,js,css]=await Promise.all([
  readFile(new URL('public/council-room.html',root),'utf8'),
  readFile(new URL('public/action-desk.js',root),'utf8'),
  readFile(new URL('public/action-desk.css',root),'utf8')
 ]);
 assert.match(html,/id="owner-action-desk"/);
 assert.match(html,/id="desk-note-confirm" type="button" hidden/);
 assert.match(html,/src="\/action-desk\.js"/);
 assert.match(html,/href="\/action-desk\.css"/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/\/api\/brain\/tasks/);
 assert.match(js,/\/api\/brain\/cloud-action/);
 assert.match(js,/note-and-receipt-persisted/);
 assert.match(js,/queue-receipt-mismatch/);
 assert.match(js,/\.textContent=/);
 assert.doesNotMatch(js,/Authorization\s*:/i);
 assert.doesNotMatch(js,/api\/brain\/council-act|\/issues\/\d+\/comments/);
 assert.match(css,/@media\(max-width:800px\)/);
 assert.doesNotMatch(html+js+css,/-----BEGIN (?:RSA )?PRIVATE KEY-----/);
});
