import test from 'node:test';
import assert from 'node:assert/strict';
import { runRepairPR, createMemoryRepairLedger } from '../src/repair-pr-reconciler.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const SHA='a'.repeat(40), PREPARED='b'.repeat(40);
const NOW='2026-10-31T17:00:00Z';
const plan=()=>({
 schema:'ultron.repair.plan.v1',owner:'michaeljwilliams0123',
 objective:'Fix seeded failing unit test via bounded PR',repository:REPO,
 baseSha:SHA,preparedHeadSha:PREPARED,branch:'ultron/repair-seeded-case',
 allowedPaths:['src/seed.mjs','test/seed.test.mjs'],
 idempotencyKey:'repair:seeded-pr-001',maxAttempts:2,maxCostCents:0,
 expiresAt:'2026-10-31T18:00:00Z'
});
const identity=()=>({
 source:'github-installation-token-readback',verified:true,
 principal:'repair-app',repository:REPO,repositoryId:1424939667,
 installationId:12345,actorRef:'github-app:ultron-repair',
 expiresAt:'2026-10-31T17:50:00Z',
 permissions:{metadata:'read',contents:'write',pull_requests:'write',checks:'read',issues:'write'}
});
const context=()=>({now:NOW,controls:{paused:false,revoked:false},identityEvidence:identity()});
function fakeGitHub({loseBranch=false,losePR=false,autoPrepare=true}={}){
 let branch=null,pr=null;
 const calls={branch:0,pr:0,reads:0};
 const github={
   async getBranch(){
     calls.reads++;
     // Simulated *external* code worker: production must supply real commit
     // provenance, not this test-only preparation shortcut.
     if(branch&&autoPrepare&&branch.sha===SHA)branch={...branch,sha:PREPARED};
     return branch&&{...branch};
   },
   async createBranch({branch:ref,baseSha}) {
     calls.branch++;branch={repo:REPO,ref,sha:baseSha};
     if(loseBranch)throw Error('connection lost after GitHub accepted branch');
   },
   async findPR(){calls.reads++;return pr&&{...pr};},
   async createPR({branch:ref,base,title,body,draft}) {
     calls.pr++;
     if(!branch||branch.sha===SHA)throw Error('No commits between base and head');
     pr={number:71,repo:REPO,head:ref,headSha:branch.sha,base,title,body,draft};
     if(losePR)throw Error('connection lost after GitHub accepted PR');
   }
 };
 return {github,calls, removeBranch(){branch=null;},removePR(){pr=null;},
   setPR(value){pr=value;},setBranch(value){branch=value;},
   prepareCommit(){if(!branch)throw Error('branch missing');branch={...branch,sha:PREPARED};}};
}
function args({ledger=createMemoryRepairLedger(),service=fakeGitHub(),readContext=context,task=plan()}={}){
 return {ledger,github:service.github,readContext,plan:task};
}

test('one admitted objective creates one branch and one non-draft PR to main, with receipt',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 const result=await runRepairPR(args({ledger,service}));
 assert.equal(result.status,'complete');
 assert.equal(result.prNumber,71);
 assert.equal(result.branch,plan().branch);
 assert.equal(result.baseSha,SHA);
 assert.match(result.fingerprint,/^[a-f0-9]{64}$/);
 assert.match(result.prMarker,/^<!-- ultron-repair:[a-f0-9]{64} -->$/);
 assert.deepEqual({branch:service.calls.branch,pr:service.calls.pr},{branch:1,pr:1});
 assert.equal((await ledger.get(plan().idempotencyKey)).phase,'complete');
});

test('duplicate delivery and restart do not duplicate branch or PR',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 await runRepairPR(args({ledger,service}));
 const second=await runRepairPR(args({ledger,service}));
 assert.equal(second.status,'complete');
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,1);
});

test('lost branch response is reconciled by exact object readback, no replay',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub({loseBranch:true});
 const receipt=await runRepairPR(args({ledger,service}));
 assert.equal(receipt.status,'complete');
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,1);
});

test('lost PR response is reconciled without duplicate creation',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub({losePR:true});
 const receipt=await runRepairPR(args({ledger,service}));
 assert.equal(receipt.status,'complete');
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,1);
});

test('unobserved lost branch write remains uncertain even after restart',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub({loseBranch:true});
 const original=service.github.createBranch;
 service.github.createBranch=async params=>{try{await original(params);}finally{service.removeBranch();}};
 const first=await runRepairPR(args({ledger,service}));
 assert.equal(first.status,'reconcile-required');
 assert.equal(first.phase,'branch-dispatch');
 const second=await runRepairPR(args({ledger,service}));
 assert.equal(second.status,'reconcile-required');
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,0);
});

test('unobserved lost PR write is not replayed on restart',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub({losePR:true});
 const original=service.github.createPR;
 service.github.createPR=async params=>{try{await original(params);}finally{service.removePR();}};
 const first=await runRepairPR(args({ledger,service}));
 assert.equal(first.status,'reconcile-required');
 const second=await runRepairPR(args({ledger,service}));
 assert.equal(second.status,'reconcile-required');
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,1);
});

test('same key with altered objective fails before new external mutation',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 await runRepairPR(args({ledger,service}));
 await assert.rejects(runRepairPR(args({ledger,service,task:{...plan(),objective:'Different admitted repair objective'}})),/fingerprint|collision/);
 assert.equal(service.calls.pr,1);
});

test('pause, revoked identity and scope violation deny before branch or PR mutation',async()=>{
 for(const changed of [
   {readContext:async()=>({...context(),controls:{paused:true,revoked:false}})},
   {readContext:async()=>({...context(),identityEvidence:{...identity(),principal:'admin-app'}})},
   {task:{...plan(),branch:'main'}},
   {task:{...plan(),maxCostCents:10}},
 ]) {
   const service=fakeGitHub(),ledger=createMemoryRepairLedger();
   await assert.rejects(runRepairPR(args({ledger,service,...changed})),/Repair/);
   assert.deepEqual({branch:service.calls.branch,pr:service.calls.pr},{branch:0,pr:0});
 }
});

test('preexisting foreign branch is not silently reused',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 service.setBranch({repo:REPO,ref:plan().branch,sha:SHA});
 await assert.rejects(runRepairPR(args({ledger,service})),/preexisting|ownership/);
 assert.equal(service.calls.branch,0);
 assert.equal(service.calls.pr,0);
});

test('forged PR marker and altered head are rejected after lost response',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub({losePR:true});
 const original=service.github.createPR;
 service.github.createPR=async params=>{try{await original(params);}finally{service.setPR({number:71,repo:REPO,head:'main',base:'main',body:'forged',draft:false});}};
 await assert.rejects(runRepairPR(args({ledger,service})),/PR readback|identity mismatch/);
 assert.equal(service.calls.pr,1);
});

test('simultaneous duplicate delivery cannot dispatch two external actions',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 const two=await Promise.all([runRepairPR(args({ledger,service})),runRepairPR(args({ledger,service}))]);
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,1);
 assert.equal(two.some(x=>x.status==='complete'),true);
});

test('completed attempt rechecks exact branch and PR, never trusts an old ledger status',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 await runRepairPR(args({ledger,service}));
 service.setPR({number:71,repo:REPO,head:'main',base:'main',title:'forged',
   body:'forged',draft:false});
 await assert.rejects(runRepairPR(args({ledger,service})),/PR readback identity mismatch/);
 assert.equal(service.calls.pr,1);
});

test('deleted PR after completion remains uncertain and never creates a duplicate',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 await runRepairPR(args({ledger,service}));
 service.removePR();
 const receipt=await runRepairPR(args({ledger,service}));
 assert.equal(receipt.status,'reconcile-required');
 assert.equal(service.calls.pr,1);
});

test('changed branch head after confirmation denies PR dispatch or stale completion',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 await runRepairPR(args({ledger,service}));
 service.setBranch({repo:REPO,ref:plan().branch,sha:'c'.repeat(40)});
 await assert.rejects(runRepairPR(args({ledger,service})),/branch readback identity mismatch/);
 assert.equal(service.calls.pr,1);
});

test('stale reserved snapshot from concurrent loser adopts its own completed ledger, not a foreign-branch error',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 await runRepairPR(args({ledger,service}));
 const stale={...ledger,claim:async({key,fingerprint})=>({
   claimed:false,entry:{key,fingerprint,phase:'reserved',prNumber:null}
 })};
 const second=await runRepairPR(args({ledger:stale,service}));
 assert.equal(second.status,'complete');
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,1);
});

test('stale branch-confirmed snapshot from concurrent loser never redelivers PR',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 await runRepairPR(args({ledger,service}));
 const stale={...ledger,claim:async({key,fingerprint})=>({
   claimed:false,entry:{key,fingerprint,phase:'branch-confirmed',prNumber:null}
 })};
 const second=await runRepairPR(args({ledger:stale,service}));
 assert.equal(second.status,'complete');
 assert.equal(service.calls.pr,1);
});

test('fresh owner pause between branch confirmation and PR blocks new PR write',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 let readCount=0;
 const readContext=async()=>{
   readCount++;
   return readCount>=3?{...context(),controls:{paused:true,revoked:false}}:context();
 };
 await assert.rejects(
   runRepairPR(args({ledger,service,readContext})),/Repair step denied/
 );
 assert.equal(service.calls.branch,1);
 assert.equal(service.calls.pr,0);
 assert.equal((await ledger.get(plan().idempotencyKey)).phase,'branch-confirmed');
});

test('fresh identity swap before branch dispatch blocks all mutations',async()=>{
 const ledger=createMemoryRepairLedger(),service=fakeGitHub();
 let n=0;
 const readContext=async()=>++n===1?context():{
   ...context(),identityEvidence:{...identity(),installationId:98765}
 };
 await assert.rejects(runRepairPR(args({ledger,service,readContext})),/Repair step denied/);
 assert.equal(service.calls.branch,0);
 assert.equal(service.calls.pr,0);
});

test('base-only branch remains pending until an external prepared commit is read back',async()=>{
  const ledger=createMemoryRepairLedger(),service=fakeGitHub({autoPrepare:false});
  const pending=await runRepairPR(args({ledger,service}));
  assert.equal(pending.status,'reconcile-required');
  assert.equal(pending.phase,'branch-confirmed');
  assert.equal(service.calls.branch,1);
  assert.equal(service.calls.pr,0,'never send GitHub a base-only PR write');
  service.prepareCommit();
  const complete=await runRepairPR(args({ledger,service}));
  assert.equal(complete.status,'complete');
  assert.equal(complete.preparedHeadSha,PREPARED);
  assert.equal(service.calls.branch,1);
  assert.equal(service.calls.pr,1);
});

test('wrong or missing prepared SHA fails closed before PR dispatch',async()=>{
  for(const bad of [undefined,SHA,'c'.repeat(40)]){
    const ledger=createMemoryRepairLedger(),service=fakeGitHub({autoPrepare:false});
    const task=plan();
    if(bad===undefined)delete task.preparedHeadSha;
    else task.preparedHeadSha=bad;
    if(bad===SHA){
      await assert.rejects(runRepairPR(args({ledger,service,task})),/Repair plan/);
      continue;
    }
    const pending=await runRepairPR(args({ledger,service,task}));
    assert.equal(pending.status,'reconcile-required');
    service.prepareCommit();
    if(bad===undefined){
      const still=await runRepairPR(args({ledger,service,task}));
      assert.equal(still.status,'reconcile-required');
    }else await assert.rejects(runRepairPR(args({ledger,service,task})),/branch readback identity mismatch/);
    assert.equal(service.calls.pr,0);
  }
});
