import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../cloud/hatchable/',import.meta.url);
const owner={handle:'michaeljwilliams0123'};
const a='chat-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const b='chat-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 for(const name of ['0001_tasks.sql','0024_council_room.sql','0025_council_room_execution.sql','0051_council_conversations.sql'])
  await db.exec(await readFile(new URL('migrations/'+name,root),'utf8'));
 let wakeups=0;
 globalThis.__conversationTest={db,scheduler:{async now(){wakeups++;}},events:{async publish(){}}};
 const src=(await readFile(new URL('api/brain/council-room.js',root),'utf8'))
  .replace("import {db,scheduler,events} from 'hatchable';",'const {db,scheduler,events}=globalThis.__conversationTest;')
  .replace("import {COUNCIL_ROOM_ROLES} from 'lib/council-room-core.js';",'const COUNCIL_ROOM_ROLES=[];');
 const {default:route}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64')+'#'+Math.random());
 const call=(method,body={},query={},member=owner)=>route({method,body,query,member},{code:200,
  status(n){this.code=n;return this;},setHeader(){},json(body){return {status:this.code,body};}});
 return {db,call,wakeups:()=>wakeups};
}
test('conversations isolate messages, task replies and retries without losing the legacy room',async t=>{
 const {db,call,wakeups}=await fixture(t);
 for(const [room,title] of [[a,'Scheduler acceptance'],[b,'UI redesign']])
  assert.equal((await call('POST',{action:'conversation.create',room,title})).status,200);
 const payload={room:a,messageKey:'room:thread-isolation-001',body:'Inspect current source',mentions:[]};
 const sent=await call('POST',payload);assert.equal(sent.status,201);
 assert.equal((await call('POST',payload)).body.created,false);
 assert.equal(wakeups(),1);
 assert.equal((await call('POST',{...payload,room:b})).status,409);
 assert.equal((await call('POST',{...payload,body:'Changed intent'})).status,409);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM brain_tasks')).rows[0].n,1);
 const first=await call('GET',{}, {room:a});
 assert.equal(first.body.messages.length,1);assert.equal(first.body.messages[0].body,payload.body);
 assert.equal((await call('GET',{}, {room:b})).body.messages.length,0);
 assert.equal((await call('GET')).body.room.id,'owner-main');
 assert.equal((await call('GET')).body.threads.length,3);
});
test('rename pin archive and restore persist; archived conversations cannot queue work',async t=>{
 const {call,wakeups}=await fixture(t);
 await call('POST',{action:'conversation.create',room:a,title:'Initial title'});
 await call('POST',{action:'conversation.rename',room:a,title:'Release evidence'});
 await call('POST',{action:'conversation.pin',room:a,value:true});
 let view=await call('GET',{}, {room:a});assert.equal(view.body.room.title,'Release evidence');assert.equal(view.body.room.pinned,true);
 await call('POST',{action:'conversation.archive',room:a,value:true});
 assert.equal((await call('POST',{room:a,messageKey:'room:archived-001',body:'Do not run'})).status,409);
 view=await call('GET',{}, {room:a,archived:'true',search:'release'});
 assert.equal(view.body.threads.length,1);assert.equal(view.body.room.archived,true);
 await call('POST',{action:'conversation.archive',room:a,value:false});
 assert.equal((await call('GET',{}, {room:a})).body.room.archived,false);
 assert.equal((await call('POST',{action:'conversation.archive',room:'owner-main',value:true})).status,400);
 assert.equal(wakeups(),0);
});
test('owner boundary, invalid names and unknown rooms fail before thread writes',async t=>{
 const {db,call}=await fixture(t);
 assert.equal((await call('POST',{action:'conversation.create',room:a,title:'Private'}, {},{handle:'other'})).status,403);
 for(const title of ['', 'x'.repeat(121),'password: example'])
  assert.equal((await call('POST',{action:'conversation.create',room:a,title})).status,400);
 assert.equal((await call('GET',{}, {room:a})).status,404);
 assert.equal((await call('GET',{}, {room:'../bad'})).status,400);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM council_room_threads')).rows[0].n,1);
});

test('conversation listing searches titles, orders pinned rooms first and separates archives',async t=>{
 const {call}=await fixture(t);
 await call('POST',{action:'conversation.create',room:a,title:'Scheduler evidence'});
 await call('POST',{action:'conversation.create',room:b,title:'Release planning'});
 await call('POST',{action:'conversation.pin',room:a,value:true});
 let view=await call('GET');assert.equal(view.body.threads[0].id,a);
 view=await call('GET',{}, {search:'SCHEDULER'});
 assert.deepEqual(view.body.threads.map(x=>x.id),[a]);
 assert.equal((await call('GET',{}, {search:'no matching title'})).body.threads.length,0);
 await call('POST',{action:'conversation.archive',room:a,value:true});
 assert.equal((await call('GET')).body.threads.some(x=>x.id===a),false);
 assert.deepEqual((await call('GET',{}, {archived:'true'})).body.threads.map(x=>x.id),[a]);
});

test('migration preserves old room messages and can be applied repeatedly',async t=>{
 const {db,call}=await fixture(t);
 await db.query(`INSERT INTO council_room_messages(message_key,room_key,author_type,author_id,body)
 VALUES ('legacy:history-001',$1,'owner','michaeljwilliams0123','Existing history')`,[a]);
 const migration=await readFile(new URL('migrations/0051_council_conversations.sql',root),'utf8');
 await db.exec(migration);await db.exec(migration);
 const view=await call('GET',{}, {room:a});
 assert.equal(view.body.room.title,'Earlier conversation');
 assert.equal(view.body.messages[0].body,'Existing history');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM council_room_threads')).rows[0].n,2);
});
