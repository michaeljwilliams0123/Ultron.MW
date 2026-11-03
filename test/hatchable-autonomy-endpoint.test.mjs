import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../cloud/hatchable/api/brain/autonomy.js',import.meta.url),'utf8');
const replaced=source
 .replace("import {db} from 'hatchable';","const db={};")
 .replace("import {readOwnerProfile,setOwnerProfile} from 'lib/owner-autonomy-control.js';",
   "export let testWrites=0; const readOwnerProfile=async()=>({version:3,preset:'build'}); "+
   "const setOwnerProfile=async()=>{testWrites++;return {ok:true,profile:{version:4,preset:'build'}};};");
assert.notEqual(replaced,source,'Hatchable endpoint must use mock dependencies for isolated tests');
assert.ok(!replaced.includes("from 'hatchable'") && !replaced.includes("from 'lib/owner-autonomy-control.js'"));
const mod=await import('data:text/javascript;base64,'+Buffer.from(replaced).toString('base64'));
function reply(){
 return {code:200,body:null,status(n){this.code=n;return this},
   json(payload){this.body=payload;return this}};
}
async function post(body){
 const response=reply();
 await mod.default({method:'POST',body},response);
 return response;
}
test('C18 live-reproduced: unsupported paid, owner, or principal fields must be rejected before any write',async()=>{
 for(const extra of [
  {maxPaidCents:100},
  {paidFallback:true},
  {owner:'different-owner'},
  {db:{evil:true}},
  {newAuthority:'all'},
  {permissions:['administration:write']},
 ]){
  const response=await post({expectedVersion:3,preset:'build',reason:'negative case only',...extra});
  assert.equal(response.code,400,'unexpected config keys must be invalid');
  assert.equal(response.body?.error,'invalid-autonomy-profile');
 }
 assert.equal(mod.testWrites,0,'no version increment or event receipt on rejected input');
});
test('C18 endpoint rejects array, scalar, null and accessor-based requests before persistence',async()=>{
 const getter={expectedVersion:3,preset:'build',reason:'getter test'};
 let reads=0;
 Object.defineProperty(getter,'maxPaidCents',{enumerable:true,
  get(){reads++;return 0}});
 for(const body of [[],null,17,'a',getter]){
  const response=await post(body);
  assert.equal(response.code,400);
 }
 assert.equal(reads,0);
 assert.equal(mod.testWrites,0);
});
test('C18 endpoint retains valid authenticated owner updates and read path',async()=>{
 assert.equal(mod.access,'admin');
 const good=await post({expectedVersion:3,preset:'build',reason:'approved owner config'});
 assert.equal(good.code,200);
 assert.equal(mod.testWrites,1);
 const response=reply();
 await mod.default({method:'GET'},response);
 assert.equal(response.code,200);
 assert.equal(response.body.profile.version,3);
});
