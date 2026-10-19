import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTask,executeCloudTask,formatReceipt,REPOSITORY,MARKER } from '../src/cloud-cycle.mjs';
import { runCloudEntry } from '../src/cloud-entry.mjs';
import { createCloudTaskUrl } from '../docs/core/cloud-submit.mjs';

const SHA='a'.repeat(40),TREE='b'.repeat(40);
const issue=(objective='/repo inspect')=>({
  action:'opened',issue:{number:17,title:'[Ultron Cloud] Objective',
    user:{login:'michaeljwilliams0123'},body:'ULTRON_CLOUD_V1\n'+objective},
});
const get=async path=>{
  if(path.includes('/issues?state=all&per_page=100&page='))return [];
  if(path.endsWith('/git/ref/heads/main'))return {object:{sha:SHA}};
  if(path.endsWith('/git/commits/'+SHA))return {tree:{sha:TREE}};
  if(path.endsWith('/git/trees/'+TREE+'?recursive=1'))
    return {truncated:false,tree:[{type:'blob',path:'docs/app.js'},
      {type:'blob',path:'src/server.mjs'},{type:'tree',path:'docs'}]};
  throw Error('Unexpected read '+path);
};
const task=(objective)=>parseTask(issue(objective),'issues','michaeljwilliams0123',REPOSITORY);

test('Pages creates token-free owner-confirmed GitHub issue link',()=>{
  const link=new URL(createCloudTaskUrl('/repo inspect'));
  assert.equal(link.hostname,'github.com');
  assert.equal(link.pathname,'/michaeljwilliams0123/Ultron.MW/issues/new');
  assert.equal(link.searchParams.get('title'),'[Ultron Cloud] Objective');
  assert.equal(link.searchParams.get('body'),'ULTRON_CLOUD_V1\n/repo inspect');
  assert.equal(link.searchParams.has('token'),false);
  assert.throws(()=>createCloudTaskUrl('a\nb'),/one nonempty line/);
});

test('only owner-originated, explicitly marked issues can execute',()=>{
  assert.equal(task('/help').issueNumber,17);
  const manual=parseTask({inputs:{objective:'/help'},sender:{login:'michaeljwilliams0123'}},
    'workflow_dispatch','michaeljwilliams0123',REPOSITORY);
  assert.equal(manual.issueNumber,null);
  assert.throws(()=>parseTask(issue(),'issues','intruder',REPOSITORY),/Untrusted/);
  assert.throws(()=>parseTask({...issue(),issue:{...issue().issue,user:{login:'intruder'}}},
    'issues','michaeljwilliams0123',REPOSITORY),/Untrusted issue/);
  assert.throws(()=>parseTask(issue(),'issues','michaeljwilliams0123','wrong/repo'),/Untrusted/);
  assert.throws(()=>parseTask(issue('/repo inspect\ndeploy now'),'issues',
    'michaeljwilliams0123',REPOSITORY),/Invalid single-line/);
});

test('hosted executor inspects authoritative main, not local hard disk',async()=>{
  const receipt=await executeCloudTask(task('/repo inspect'),{get,runId:'3123',now:()=> '2026-10-19'});
  assert.equal(receipt.status,'succeeded');
  assert.equal(receipt.localMachineRequired,false);
  assert.equal(receipt.autonomousWriteAccess,false);
  assert.equal(receipt.receipts[0].details.mainSha,SHA);
  assert.equal(receipt.receipts[0].details.fileCount,2);
  assert.equal(receipt.cognition.kind,'grokbot-deliberation-receipt');
  assert.equal(receipt.cognition.decision,'proceed');
  assert.equal(receipt.cognition.authority.mode,'advisory-only');
  assert.equal(receipt.cognition.authority.actionAuthority,'unchanged');
  assert.equal(receipt.cognition.modelInvocations,0);
  assert.equal(receipt.cognition.creditCost,0);
  assert.match(formatReceipt(receipt),/GitHub-hosted/);
  assert.match(formatReceipt(receipt),/Cognitive recommendation: proceed/);
});

test('all-or-nothing refusal of unsafe mixed objectives without Github API call',async()=>{
  for(const objective of ['delete files','deploy new code','run shell command',
    'inspect repo and destroy files']){
    let calls=0;
    const r=await executeCloudTask(task(objective),{
      get:async()=>{calls++;throw Error('must not execute');},
    });
    assert.equal(r.status,'blocked');
    assert.equal(calls,0);
    assert.equal(r.receipts[0].status,'blocked');
    assert.equal(r.cognition.decision,'hold');
    assert.equal(r.cognition.authority.executable,false);
  }
});

test('issue receipt is posted and independently reread exactly once',async()=>{
  const comments=[];
  const reader=async path=>path.includes('/issues/comments/')?comments.find(x=>x.id===42):
    path.includes('/comments')?comments:
    path==='/repos/'+REPOSITORY+'/issues/17'?{...issue().issue,state:'open'}:get(path);
  let writes=0;
  const poster=async(path,data)=>{
    assert.equal(path,'/repos/'+REPOSITORY+'/issues/17/comments');
    writes++;
    const comment={id:42,user:{login:'github-actions[bot]'},body:data.body};
    comments.push(comment);
    return comment;
  };
  const req={event:issue(),eventName:'issues',actor:'michaeljwilliams0123',
    repository:REPOSITORY,get:reader,post:poster,executorSha:SHA};
  const first=await runCloudEntry(req);
  assert.equal(first.status,'succeeded');
  assert.equal(first.sourceAuthority.admittedMainSha,SHA);
  assert.equal(first.sourceAuthority.preReceiptMainSha,SHA);
  assert.equal(writes,1);
  assert.ok(comments[0].body.includes(MARKER));
  const replay=await runCloudEntry(req);
  assert.equal(replay.status,'already-processed');
  assert.equal(writes,1);
});

test('cloud jobs never claim an always-running model or cloud learning evidence',async()=>{
  const r=await executeCloudTask(task('show system status and show learning status'),{get});
  assert.equal(r.status,'succeeded');
  assert.equal(r.receipts.length,2);
  assert.equal(r.receipts[0].details.ephemeral,true);
  assert.equal(r.receipts[1].details.qualifiedExperiences,0);
  assert.equal(r.receipts[1].details.verifiedTasks,0);
  assert.equal(r.receipts[1].details.learningStatus,'insufficient-evidence');
});


test('scheduled cloud heartbeat is fixed, account-independent and cannot execute external input',async()=>{
  const scheduled=parseTask({inputs:{objective:'delete everything'}},'schedule',
    'github-actions[bot]',REPOSITORY);
  assert.equal(scheduled.objective,'/self scan');
  assert.equal(scheduled.issueNumber,null);
  assert.equal(scheduled.repository,REPOSITORY);
  assert.throws(()=>parseTask({},'schedule','github-actions[bot]','someone/other'),/Untrusted/);
  const result=await executeCloudTask(scheduled,{get});
  assert.equal(result.status,'succeeded');
  assert.equal(result.receipts.length,1);
  assert.equal(result.receipts[0].command,'/self scan');
  assert.equal(result.receipts[0].details.sourceAuthority.commitSha,SHA);
  assert.equal(result.cognition.decision,'proceed');
  assert.equal(result.cognition.paidFallback,false);
});
