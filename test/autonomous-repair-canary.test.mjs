import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function cli(scenario,env={}){
 const result=spawnSync(process.execPath,
  ['scripts/autonomous-repair-canary.mjs','--scenario',scenario,'--json'],{
   cwd:root,encoding:'utf8',timeout:35000,maxBuffer:100000,
   shell:false,env:{...process.env,...env}});
 return result;
}
test('offline repair canary exercises durable PostgreSQL success, retry and exhaustion',()=>{
 for(const [scenario,status,attempt] of [
  ['success','completed',1],['repair','completed',2],['exhausted','exhausted',3]
 ]){
  const output=cli(scenario);
  assert.equal(output.status,0,scenario+': '+output.stderr);
  const body=JSON.parse(output.stdout);
  assert.equal(body.mode,'offline-local-simulation');
  assert.equal(body.status,status);
  assert.equal(body.attempt,attempt);
  assert.ok(body.history.length>=3);
  assert.equal(body.maxPaidCents,0);
  assert.equal(body.externalWrites,false);
 }
});
test('response-loss and pending-CI canaries resume across a fresh coordinator call without duplicate writes',()=>{
 for(const scenario of ['response-loss','pending']){
  const output=cli(scenario);
  assert.equal(output.status,0,scenario+': '+output.stderr);
  const body=JSON.parse(output.stdout);
  assert.equal(body.status,'completed');
  assert.equal(body.dispatches.patch,1);
  assert.equal(body.dispatches.publish,1);
  assert.equal(body.dispatches.verify,1);
  assert.ok(body.resumeCount>=1);
 }
});
test('canary rejects unknown modes, cannot use credentials and never claims a live write',()=>{
 const bad=cli('production');
 assert.notEqual(bad.status,0);
 const good=cli('success',{GITHUB_TOKEN:'TEST-SHOULD-NOT-BE-USED'});
 assert.equal(good.status,0);
 assert.doesNotMatch(good.stdout,/TEST-SHOULD-NOT-BE-USED/);
 const payload=JSON.parse(good.stdout);
 assert.equal(payload.externalWrites,false);
 assert.equal(payload.liveAcceptance,false);
});
