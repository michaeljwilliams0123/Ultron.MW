import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveWorkflowInstanceId,handleQueue} from '../cloudflare/edge-shield/src/queue.ts';
const REPO='michaeljwilliams0123/Ultron.MW';
const sha='a'.repeat(40);
const delivery='d06bcf83-79a3-4cba-842a-0be70e958a35';
const event={repo:REPO,delivery,sha,receivedAt:'2026-11-24T22:00:00Z'};
async function run(body,{binding=true,fail=false,duplicate=false}={}){
 const result={ack:0,retry:0,requests:[]};
 const env={GITHUB_REPO:REPO,RELEASE_PROOF:binding?{create:async request=>{
  if(duplicate){const err=Error('Workflow instance already exists');err.code=10200;throw err;}
  if(fail)throw Error('unavailable');
  result.requests.push(request);
 }}:undefined};
 await handleQueue({messages:[{body,ack(){result.ack++},retry(){result.retry++}}]},env);
 return result;
}
test('completed core check wakes read-only watch with deterministic workflow ID and no caller manifest inputs',async()=>{
 const r=await run({...event,kind:'check_suite',conclusion:'success'});
 const expectedId=await deriveWorkflowInstanceId(REPO,'check_suite',sha,delivery);
 assert.match(expectedId,/^rp-[a-f0-9]{48}$/);
 assert.equal(r.ack,1);assert.equal(r.retry,0);
 assert.deepEqual(r.requests,[{id:expectedId,params:{mode:'watch',reason:'check_suite',repo:REPO,sourceSha:sha}}]);
});
test('main push and successful deployment wake watch without treating event as receipt',async()=>{
 for(const body of [{...event,kind:'push',branch:'main'},{...event,kind:'deploy',target:'hatchable-v157',artifactDigest:'sha256:'+'f'.repeat(64),manifestFileCount:999}]){
  const r=await run(body);
  assert.equal(r.requests.length,1);assert.match(r.requests[0].id,/^rp-[a-f0-9]{48}$/);
  assert.equal(r.requests[0].params.mode,'watch');
  assert.equal(r.requests[0].params.sourceSha,sha);
  assert.equal(r.requests[0].params.artifactDigest,undefined);
  assert.equal(r.requests[0].params.manifestFileCount,undefined);
  assert.equal(r.requests[0].params.target,undefined);
  assert.equal(r.ack,1);
 }
});
test('duplicate workflow admission is acknowledged idempotently without retry',async()=>{
 const r=await run({...event,kind:'check_suite',conclusion:'success'},{duplicate:true});
 assert.equal(r.ack,1);assert.equal(r.retry,0);assert.equal(r.requests.length,0);
});
test('unknown repo, wrong branch, failed check, malformed SHA never start a watch',async()=>{
 for(const body of [
  {...event,kind:'push',branch:'main',repo:'other/repo'},
  {...event,kind:'push',branch:'dev'},
  {...event,kind:'check_suite',conclusion:'failure'},
  {...event,kind:'deploy',sha:'bad'},
  {...event,kind:'unknown'}
 ]){
  const r=await run(body);
  assert.equal(r.requests.length,0);assert.equal(r.ack,1);assert.equal(r.retry,0);
 }
});
test('failed workflow start is retried, not acknowledged',async()=>{
 const r=await run({...event,kind:'check_suite',conclusion:'success'},{fail:true});
 assert.equal(r.retry,1);assert.equal(r.ack,0);
});
test('unconfigured workflow binding does not pretend an event was processed',async()=>{
 const r=await run({...event,kind:'check_suite',conclusion:'success'},{binding:false});
 assert.equal(r.retry,1);assert.equal(r.ack,0);
});
