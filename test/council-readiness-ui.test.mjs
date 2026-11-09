import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function render(body,status=200){
 const source=await readFile(new URL('../cloud/hatchable/public/council-readiness.js',import.meta.url),'utf8');
 const value={textContent:''},detail={textContent:''};
 const tile={dataset:{},querySelector(selector){
  return selector==='.connection-value'?value:detail;
 }};
 const listeners=[];
 const document={getElementById(id){return id==='connection-council'?tile:
  {addEventListener(_event,handler){listeners.push(handler)}}}};
 const calls=[];
 const context={document,AbortSignal,fetch:async(url,options)=>{
  calls.push({url,options});return {ok:status===200,status,json:async()=>body};
 }};
 vm.runInNewContext(source,context);
 await new Promise(resolve=>setImmediate(resolve));
 return {tile,value,detail,calls,listeners};
}

test('Council UI shows unverified App identities without implying release approval',async()=>{
 const result=await render({schema:'ultron.council.wiring-readiness.v1',
  readyForProduction:false,githubRoleInstallationsObserved:0,roleCount:7,
  missingTables:[],rolesUnverified:['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion']});
 assert.equal(result.tile.dataset.state,'warning');
 assert.match(result.value.textContent,/Not release ready/);
 assert.match(result.detail.textContent,/0 of 7 GitHub App identities verified/);
 assert.equal(result.calls[0].url,'/api/brain/council-readiness');
 assert.equal(result.calls[0].options.credentials,'same-origin');
});

test('Council UI marks failed readiness readback as unverified',async()=>{
 const result=await render({error:'council-readiness-unavailable'},503);
 assert.equal(result.tile.dataset.state,'error');
 assert.match(result.value.textContent,/Unverified/);
 assert.doesNotMatch(result.detail.textContent,/ready/i);
});
