import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 validateGithubWorkflowPayload,compareGithubRun,selectArtifactMetadata,
 mergeVerifiedWorkflow,admitGithubDelivery
} from '../cloud/hatchable/lib/hf-github-receipts.js';
const read=path=>readFileSync(path,'utf8');
const RUN=41771806146, SHA='a'.repeat(40),OWNER='michaeljwilliams0123';
const run=(overrides={})=>({
 id:RUN,run_attempt:1,path:'.github/workflows/c06-owner-model-release.yml',
 event:'workflow_dispatch',status:'completed',conclusion:'failure',
 head_sha:SHA,head_branch:'main',actor:{login:OWNER,id:308995719},
 repository:{full_name:'Ultron-MW/Ultron.MW',private:false},
 ...overrides
});
const payload=(overrides={})=>({action:'completed',repository:{full_name:'Ultron-MW/Ultron.MW',private:false},
 workflow_run:run(),...overrides});
test('GH-HF-01: only signed-intended owner, public main, completed and allowlisted workflow events qualify',()=>{
 const x=validateGithubWorkflowPayload(payload());
 assert.equal(x.workflowKey,'c06');
 assert.equal(x.runId,RUN);
 assert.equal(x.conclusion,'failure');
 assert.equal(x.sourceSha,SHA);
 const validNames=[
 '.github/workflows/hf-heldout-cpu.yml',
 '.github/workflows/hf-free-cpu-tournament.yml'];
 assert.deepEqual(validNames.map(path=>validateGithubWorkflowPayload(payload({
  workflow_run:run({path})
 })).workflowKey),['heldout','tournament']);
});
test('GH-HF-02: reject forged repository, actor, paths, paid/private branch, and uncompleted run',()=>{
 const invalid=[
 payload({repository:{full_name:'attacker/Ultron.MW',private:false}}),
 payload({workflow_run:run({repository:{full_name:'attacker/Ultron.MW'}})}),
 payload({workflow_run:run({path:'.github/workflows/other.yml'})}),
 payload({workflow_run:run({actor:{login:'attacker',id:308995719}})}),
 payload({workflow_run:run({actor:{login:OWNER,id:354634860}})}),
 payload({workflow_run:run({actor:{login:OWNER}})}),
 payload({repository:{full_name:'michaeljwilliams0123/Ultron.MW',private:false}}),
 payload({workflow_run:run({head_branch:'experimental'})}),
 payload({workflow_run:run({status:'in_progress',conclusion:null})}),
 payload({workflow_run:run({head_sha:'main'})}),
 payload({workflow_run:run({event:'push'})}),
 payload({repository:{full_name:'Ultron-MW/Ultron.MW',private:true}}),
 payload({action:'requested'})
 ];
 for(const bad of invalid)assert.throws(()=>validateGithubWorkflowPayload(bad));
});
test('GH-HF-03: independent GitHub readback must agree with signed run identity',()=>{
 const trusted=validateGithubWorkflowPayload(payload());
 assert.equal(compareGithubRun(trusted,run()).verified,true);
 assert.equal(compareGithubRun(trusted,run({head_sha:'b'.repeat(40)})).verified,false);
 assert.equal(compareGithubRun(trusted,run({conclusion:'success'})).verified,false);
 assert.equal(compareGithubRun(trusted,run({run_attempt:2})).verified,false);
});
test('GH-HF-04: artifacts are metadata-only and constrained to workflow-specific names',()=>{
 const arr=[{id:99,name:'c06-model-output-41771806146',size_in_bytes:1234,
 digest:'sha256:'+'a'.repeat(64),expired:false},
 {id:100,name:'unsafe-credentials',size_in_bytes:4,digest:'sha256:'+'b'.repeat(64)},
 {id:101,name:'c06-model-output-41771806146',expired:true,size_in_bytes:5}];
 const result=selectArtifactMetadata('c06',RUN,arr);
 assert.equal(result.length,1);
 assert.deepEqual(Object.keys(result[0]).sort(),['digest','id','name','sizeBytes']);
 assert.equal(result[0].digest,'sha256:'+'a'.repeat(64));
});
test('GH-HF-05: never promote old model benchmarks from a completed workflow',()=>{
 const cached={schema:'ultron.hf-lab.v1',
 workflows:[{key:'c06',state:'observed',runId:12,conclusion:'success'}],
 benchmark:{models:[{key:'coder-large',approvedUse:'noncommercial-evaluation-only',productionEligible:false}]},
 release:{productionAccepted:false,autoPromotion:false}};
 const rec={workflow_key:'c06',run_id:RUN,run_attempt:1,
  source_sha:SHA,conclusion:'failure',state:'verified',
  github_verified_at:'2026-11-04T04:41:00Z',artifacts:[]};
 const out=mergeVerifiedWorkflow(cached,[rec]);
 assert.equal(out.workflows[0].runId,RUN);
 assert.equal(out.workflows[0].conclusion,'failure');
 assert.equal(out.workflows[0].observation,'signed-webhook+github-readback');
 assert.equal(out.release.productionAccepted,false);
 assert.equal(out.benchmark.models[0].productionEligible,false);
});
test('GH-HF-06: duplicate signed delivery has exactly-once durable insertion',async()=>{
 let row=null;let insert=0;
 const db={async query(sql,args){
  if(sql.includes('INSERT INTO hf_github_receipts')){
   insert++;if(row)return {rows:[]};
   row={id:51,delivery_id:args[0],run_id:args[1],run_attempt:args[2],workflow_key:args[3],
    source_sha:args[4],conclusion:args[5],payload_sha256:args[6],state:'pending'};
   return {rows:[row]};
  }
  if(sql.includes('SELECT id,delivery_id,run_id'))return {rows:row?[row]:[]};
  throw Error('unexpected SQL '+sql.slice(0,75));
 }};
 const event=validateGithubWorkflowPayload(payload());
 const d='00000000-0000-4000-8000-000000000001';
 const first=await admitGithubDelivery({db,deliveryId:d,event,payloadSha256:'e'.repeat(64)});
 const second=await admitGithubDelivery({db,deliveryId:d,event,payloadSha256:'e'.repeat(64)});
 assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(insert,2);
 await assert.rejects(()=>admitGithubDelivery({db,deliveryId:d,event,payloadSha256:'f'.repeat(64)}),/delivery-id-conflict/);
});
test('GH-HF-07: real public route validates GitHub raw-body HMAC before SQL writes or publishes',()=>{
 const src=read('cloud/hatchable/api/brain/github-workflow-webhook.js');
 const migration=read('cloud/hatchable/migrations/0021_hf_github_receipts.sql');
 const worker=read('cloud/hatchable/api/brain/hf-github-reconcile.js');
 const toml=read('cloud/hatchable/hatchable.toml');
 assert.match(src,/access='public'/);
 assert.match(src,/methods=\['POST'\]/);
 assert.match(src,/req\.rawBody/);
 assert.match(src,/webhooks\.verifyHmac/);
 assert.match(src,/x-hub-signature-256/);
 assert.match(src,/ULTRON_HF_GITHUB_WEBHOOK_SECRET/);
 assert.match(worker,/access='scheduler'/);
 assert.match(worker,/github_verified_at/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS hf_github_receipts/);
 assert.match(toml,/ULTRON_HF_GITHUB_WEBHOOK_SECRET/);
});
test('GH-HF-08: owner Model Lab uses bounded persisted verified events, not browser-hosted GitHub credentials',()=>{
 const src=read('cloud/hatchable/lib/hf-lab-view.js');
 const client=read('cloud/hatchable/public/hf-lab.js');
 assert.match(src,/hf_github_receipts/);
 assert.doesNotMatch(client,/github\.com\/api|api\.github\.com|Authorization:\s*['"]Bearer/);
 assert.doesNotMatch(client,/setInterval/);
});

test('GH-HF-09: Ultron admin actor is allowed only with exact immutable GitHub user ID',()=>{
 const allowed=validateGithubWorkflowPayload(payload({workflow_run:run({
  actor:{login:'michaeljwilliams0123ultron',id:354634860}
 })}));
 assert.equal(allowed.workflowKey,'c06');
 for(const actor of [
  {login:'michaeljwilliams0123ultron',id:308995719},
  {login:'michaeljwilliams0123ultron'},
  {login:'michaeljwilliams0123',id:354634860}
 ])assert.throws(()=>validateGithubWorkflowPayload(payload({workflow_run:run({actor})})));
});
