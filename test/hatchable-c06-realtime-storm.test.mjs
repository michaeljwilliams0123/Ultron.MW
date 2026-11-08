import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../cloud/hatchable/public/c06-live.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};

function harness(){
 const listeners=new Map(),pending=[],calls=[];
 const nodes=new Map(['c06-live-start','c06-live-status','c06-live-history'].map(id=>[id,{
   id,textContent:'',disabled:false,addEventListener(){},replaceChildren(...items){this.children=items},
   append(...items){this.children??=[];this.children.push(...items)}
 }]));
 const document={getElementById:id=>nodes.get(id),createElement:tag=>({
   tag,textContent:'',append(){},
 })};
 const window={
  addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn])},
  dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)}
 };
 const fetch=(url,options)=>{
  calls.push({url,method:options.method});
  return new Promise(resolve=>pending.push(resolve));
 };
 vm.runInNewContext(source,{window,document,fetch,AbortSignal:{timeout:()=>({})},Date,Number,crypto:{randomUUID:()=> 'fixture-key'}});
 const complete=(status=200,body={rows:[]})=>{
  const resolve=pending.shift();assert.ok(resolve,'one fetch should be pending');
  resolve({ok:status===200,status,json:async()=>body});
 };
 return {window,calls,pending,complete,nodes};
}

test('C06 realtime burst coalesces repeated notifications into one trailing read',async()=>{
 const h=harness();
 assert.equal(h.calls.length,1,'initial read');
 for(let i=0;i<80;i++)h.window.dispatchEvent({type:'ultron:realtime-change'});
 assert.equal(h.calls.length,1,'no concurrent database read during an in-flight refresh');
 h.complete();
 await flush();
 assert.equal(h.calls.length,2,'one trailing read observes events during the first request');
 h.complete();
 await flush();
 assert.equal(h.calls.length,2,'no extra reads after the trailing refresh');
});

test('C06 temporary 503 does not leave refresh permanently disabled or claim success',async()=>{
 const h=harness();
 for(let i=0;i<20;i++)h.window.dispatchEvent({type:'ultron:realtime-change'});
 h.complete(503,{error:'receipt-read-unavailable'});
 await flush();
 assert.match(h.nodes.get('c06-live-status').textContent,/unavailable/i);
 assert.equal(h.calls.length,2);
 h.complete();
 await flush();
 h.window.dispatchEvent({type:'ultron:realtime-change'});
 assert.equal(h.calls.length,3,'new event after a settled read can refresh normally');
 h.complete();
 await flush();
});
