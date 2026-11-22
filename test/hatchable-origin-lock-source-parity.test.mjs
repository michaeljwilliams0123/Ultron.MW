import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const library=readFileSync(new URL('../cloud/hatchable/lib/origin-lock.js',import.meta.url),'utf8');
const route=readFileSync(new URL('../cloud/hatchable/api/brain/origin-lock-probe.js',import.meta.url),'utf8');

function load(secret) {
 const sandbox={
  TextEncoder,
  config:{async get(name){assert.equal(name,'ORIGIN_LOCK_SECRET');if(secret instanceof Error)throw secret;return secret;}}
 };
 const source=library.replace(/^import \{ config \} from 'hatchable';\s*/,'')
   .replace(/\bexport async function\b/g,'async function');
 assert.notEqual(source,library,'test adapter must remove the exact import');
 vm.runInNewContext(source+';globalThis.__functions={originLockPresent,requireOriginLock};',sandbox);
 return sandbox.__functions;
}
function response(){
 return {code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
}
test('origin lock is closed when secret is missing or lookup fails',async()=>{
 for(const secret of [null,'',new Error('secret storage unavailable')]){
  const {requireOriginLock,originLockPresent}=load(secret);
  assert.equal(await originLockPresent({headers:{'x-ultron-origin-lock':'anything'}}),false);
  const res=response();
  assert.equal(await requireOriginLock({headers:{}},res),false);
  assert.equal(res.code,403);
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)),{error:'origin-denied'});
 }
});
test('only exact protected header can pass; case-insensitive map reader is supported',async()=>{
 const {originLockPresent,requireOriginLock}=load('very-secret-token');
 for(const headers of [{},{'x-ultron-origin-lock':'very-secret-toke'},
   {'x-ultron-origin-lock':'very-secret-token1'},
   {'x-ultron-origin-lock':'other-secret-aaa'}]){
  assert.equal(await originLockPresent({headers}),false);
 }
 assert.equal(await originLockPresent({headers:{'x-ultron-origin-lock':'very-secret-token'}}),true);
 assert.equal(await originLockPresent({headers:{get:k=>k==='x-ultron-origin-lock'?'very-secret-token':null}}),true);
 const res=response();
 assert.equal(await requireOriginLock({headers:{'x-ultron-origin-lock':'very-secret-token'}},res),true);
 assert.equal(res.body,null);
});
test('public probe stays behind the fail-closed origin lock',async()=>{
 assert.match(route,/export const access = 'public'/);
 assert.match(route,/export const methods = \['GET'\]/);
 assert.match(route,/requireOriginLock\(req, res\)/);
 const {requireOriginLock}=load(null);
 const sandbox={requireOriginLock};
 const prepared=route.replace(/^import \{ requireOriginLock \} from '\.\.\/\.\.\/lib\/origin-lock\.js';\s*/,'')
   .replace('export const access','const access').replace('export const methods','const methods')
   .replace('export default async function handler','async function handler');
 assert.notEqual(prepared,route,'probe test adapter must remove imported source');
 vm.runInNewContext(prepared+';globalThis.probe=handler;',sandbox);
 const res=response();
 await sandbox.probe({headers:{}},res);
 assert.equal(res.code,403);
 assert.equal(JSON.stringify(res.body),'{"error":"origin-denied"}');
});
