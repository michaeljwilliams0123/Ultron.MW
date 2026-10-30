import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startLocalServer} from '../src/server.mjs';

async function withServer(renameState,callback){
 const dir=await mkdtemp(join(tmpdir(),'ultron-windows-rename-'));
 const statePath=join(dir,'state.json');
 const root=resolve(import.meta.dirname,'..');
 const app=await startLocalServer({root,statePath,port:0,renameState});
 const base='http://127.0.0.1:'+app.port;
 try{await callback({base,statePath,dir})}
 finally{await app.close();await rm(dir,{recursive:true,force:true})}
}
const req=(base,text)=>fetch(base+'/api/objectives',{
 method:'POST',
 headers:{'content-type':'application/json','x-ultron-client':'local-ui-v1',origin:base},
 body:JSON.stringify({text})
});
const windowsError=()=>Object.assign(new Error('sharing violation'),{code:'EPERM'});

test('transient Windows replacement failure retries without duplicate objectives',async()=>{
 let attempts=0;
 await withServer(async(a,b)=>{
  attempts++;
  if(attempts===2||attempts===3)throw windowsError();
  return rename(a,b);
 },async({base,statePath,dir})=>{
  assert.equal((await req(base,'first')).status,201);
  assert.equal((await req(base,'second')).status,201);
  assert.equal(attempts,4);
  const state=JSON.parse(await readFile(statePath,'utf8'));
  assert.deepEqual(state.objectives.map(x=>x.text),['first','second']);
  assert.equal((await readdir(dir)).some(x=>x.endsWith('.pending')),false);
 });
});

test('persistent Windows lock fails closed and does not advance in-memory state',async()=>{
 let attempts=0;
 await withServer(async(a,b)=>{
  attempts++;
  if(attempts>1)throw windowsError();
  return rename(a,b);
 },async({base,statePath,dir})=>{
  assert.equal((await req(base,'first')).status,201);
  assert.equal((await req(base,'blocked')).status,500);
  assert.ok(attempts>=2 && attempts<=8,'the retry budget is bounded');
  const state=await (await fetch(base+'/api/state')).json();
  assert.deepEqual(state.objectives.map(x=>x.text),['first']);
  assert.deepEqual(JSON.parse(await readFile(statePath,'utf8')).objectives.map(x=>x.text),['first']);
  assert.equal((await readdir(dir)).some(x=>x.endsWith('.pending')),false);
 });
});
