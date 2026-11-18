import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function render(body,status=200,proof=null){
 const source=await readFile(new URL('../cloud/hatchable/public/council-readiness.js',import.meta.url),'utf8');
 const value={textContent:''},detail={textContent:''};
 const tile={dataset:{},appendChild(){},querySelector(selector){
  return selector==='.connection-value'?value:detail;
 }};
 const listeners=[];
 const probeButton={disabled:false,addEventListener(_event,handler){this.click=handler}};
 const document={createElement(){return probeButton},getElementById(id){return id==='connection-council'?tile:
  {addEventListener(_event,handler){listeners.push(handler)}}}};
 const calls=[];
 const context={document,AbortSignal,fetch:async(url,options)=>{
  calls.push({url,options});return {ok:status===200,status,json:async()=>url.endsWith('github-app-proof')?proof:body};
 }};
 vm.runInNewContext(source,context);
 await new Promise(resolve=>setImmediate(resolve));
 return {tile,value,detail,calls,listeners,probeButton};
}

test('Council UI shows unverified App identities without implying release approval',async()=>{
 const result=await render({schema:'ultron.council.wiring-readiness.v1',
  readyForProduction:false,githubRoleInstallationsObserved:0,roleCount:7,
  missingTables:[],rolesUnverified:['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion']});
 assert.equal(result.tile.dataset.state,'warning');
 assert.equal(result.value.textContent,'Council schema ready');
 assert.match(result.detail.textContent,/7 reasoning roles/);
 assert.doesNotMatch(result.detail.textContent,/0 of 7/);
 assert.equal(result.calls.length,1); // Never mint a token on page load.
 assert.equal(result.calls[0].url,'/api/brain/council-readiness');
 assert.equal(result.calls[0].options.credentials,'same-origin');
});

test('Council UI marks failed readiness readback as unverified',async()=>{
 const result=await render({error:'council-readiness-unavailable'},503);
 assert.equal(result.tile.dataset.state,'error');
 assert.match(result.value.textContent,/Unverified/);
 assert.doesNotMatch(result.detail.textContent,/ready/i);
});

test('wiring readiness never claims independently accepted production release',async()=>{
 const result=await render({schema:'ultron.council.wiring-readiness.v1',
  readyForProduction:true,githubRoleInstallationsObserved:7,roleCount:7,
  missingTables:[],rolesUnverified:[]});
 assert.equal(result.tile.dataset.state,'warning');
 assert.equal(result.value.textContent,'Council schema ready');
 assert.match(result.detail.textContent,/GitHub App connection not checked/);
 assert.doesNotMatch(result.value.textContent,/Release ready|Release accepted/);
});

const schema={schema:'ultron.council.wiring-readiness.v1',
 readyForProduction:false,githubRoleInstallationsObserved:0,roleCount:7,
 missingTables:[],rolesUnverified:[]};
const proof={schema:'ultron.github-app-installation-proof.v1',
 state:'installation-and-scoped-read-verified',installationVerified:true,
 repositoryReadVerified:true,repository:'michaeljwilliams0123/Ultron.MW',
 repositoryId:1424939667,appId:5633654,installationId:179066535};
test('explicit App verification uses the pinned scoped-read endpoint without claiming release',async()=>{
 const r=await render(schema,200,proof);
 await r.probeButton.click();
 assert.equal(r.value.textContent,'GitHub App connected');
 assert.equal(r.tile.dataset.state,'good');
 assert.match(r.detail.textContent,/release acceptance checked separately/);
 assert.equal(r.calls[1].url,'/api/brain/github-app-proof');
 assert.equal(r.calls[1].options.method,'POST');
 assert.deepEqual(JSON.parse(r.calls[1].options.body),{mode:'probe'});
});
test('wrong installation, wrong repository or missing scoped read cannot show connected',async()=>{
 for(const bad of [{...proof,installationId:1},{...proof,repository:'other/repo'},
  {...proof,repositoryReadVerified:false},null]){
  const r=await render(schema,200,bad);await r.probeButton.click();
  assert.equal(r.value.textContent,'GitHub App unverified');
  assert.equal(r.tile.dataset.state,'warning');
 }
});
test('missing schema tables prevent App verification',async()=>{
 const r=await render({...schema,missingTables:['brain_tasks']},200,proof);
 assert.equal(r.probeButton.disabled,true);
 await r.probeButton.click();assert.equal(r.calls.length,1);
});
test('inconsistent identity counts fail closed instead of a misleading readiness status',async()=>{
 const result=await render({schema:'ultron.council.wiring-readiness.v1',
  readyForProduction:true,githubRoleInstallationsObserved:8,roleCount:7,
  missingTables:[],rolesUnverified:[]});
 assert.equal(result.tile.dataset.state,'error');
 assert.equal(result.value.textContent,'Unverified');
});
