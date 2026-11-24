import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../cloud/hatchable/lib/council-deep-dispatch.js',import.meta.url),'utf8');
const rsa=new URL('../cloud/hatchable/lib/rsa-pkcs1-sign.js',import.meta.url).href;
const transformed=source.replace("from 'lib/rsa-pkcs1-sign.js'","from '"+rsa+"'");
const {bindCouncilDeepRequestDigest}=await import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
const digest='a'.repeat(64);
test('bind deep dispatch to leased task and exact room before any external call',async()=>{
 let calls=0;
 const db={query:async(sql,args)=>{calls++;assert.match(sql,/status='leased'/);assert.match(sql,/council\.room/);assert.match(sql,/request_digest/);assert.deepEqual(args,['5',digest,'owner-main']);return {rows:[{id:8}]}}};
 assert.equal(await bindCouncilDeepRequestDigest({db,taskId:'5',requestDigest:digest,roomKey:'owner-main'}),true);
 assert.equal(calls,1);
});
test('foreign room and digest binding are denied before dispatch',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[]}}};
 assert.equal(await bindCouncilDeepRequestDigest({db,taskId:'5',requestDigest:digest,roomKey:'owner-main'}),false);
 assert.equal(await bindCouncilDeepRequestDigest({db,taskId:'5',requestDigest:'bad',roomKey:'owner-main'}),false);
 assert.equal(await bindCouncilDeepRequestDigest({db:null,taskId:'5',requestDigest:digest,roomKey:'owner-main'}),false);
 assert.equal(calls,1);
});
test('runner heartbeat cannot derive a Council request digest from numeric task ID',()=>{
 const s=readFileSync(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
 assert.doesNotMatch(s,/\$1::jsonb->'reasoningBridge'/);
});
