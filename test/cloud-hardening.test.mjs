import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCloudEntry } from '../src/cloud-entry.mjs';
import { REPOSITORY, MARKER, executeCloudTask, formatReceipt,
  MAX_TASK_ATTEMPTS } from '../src/cloud-cycle.mjs';
import { createCloudTaskUrl } from '../docs/core/cloud-submit.mjs';

const objective='/system status';
const EXECUTOR_SHA='a'.repeat(40);
const digest=createHash('sha256').update(JSON.stringify([REPOSITORY,17,objective])).digest('hex');
const event={action:'opened',issue:{number:17,title:'[Ultron Cloud] Objective',
  user:{login:'michaeljwilliams0123'},body:'ULTRON_CLOUD_V1\n'+objective}};
const request={event,eventName:'issues',actor:'michaeljwilliams0123',repository:REPOSITORY,
  executorSha:EXECUTOR_SHA};
const receiptComment=(body,id=42)=>({id,user:{login:'github-actions[bot]'},body});
const authorized=(activeEvent,next)=>async path=>{
  if(path.endsWith('/git/ref/heads/main'))return {object:{sha:EXECUTOR_SHA}};
  if(path==='/repos/'+REPOSITORY+'/issues/'+activeEvent.issue.number)
    return {...activeEvent.issue,state:'open'};
  return next(path);
};

test('public handoff publishes canonical commands and refuses unsupported sensitive text',()=>{
  const link=new URL(createCloudTaskUrl('inspect the repository and show system status'));
  assert.equal(link.searchParams.get('body'),'ULTRON_CLOUD_V1\n/repo inspect and /system status');
  for(const text of ['my password is abc123','inspect repo and email my client','review client Acme finances'])
    assert.throws(()=>createCloudTaskUrl(text),/supported read-only/);
});

test('replay audit reaches successful matching receipts beyond the first 100 comments',async()=>{
  const successful=await executeCloudTask({repository:REPOSITORY,issueNumber:17,objective},{get:async()=>{}});
  const { formatReceipt }=await import('../src/cloud-cycle.mjs');
  const reads=[];
  const result=await runCloudEntry({...request,get:authorized(event,async path=>{
    reads.push(path);
    return path.endsWith('page=2')?[receiptComment(formatReceipt(successful))]:Array.from({length:100},(_,id)=>({id,body:'discussion'}));
  }),post:async()=>{throw Error('Duplicate write');}});
  assert.equal(result.status,'already-processed');
  assert.equal(reads.length,2);
});

test('a marker alone cannot suppress execution; receipt read-back verifies exact bot-authored content',async()=>{
  for(const tamper of ['none','body','author']){
    let postedBody,writes=0;
    const get=async path=>{
      if(path.includes('/issues/comments/'))return receiptComment(
        tamper==='body'?MARKER+'\n'+digest:postedBody);
      return [receiptComment(MARKER+' unrelated old task')];
    };
    const reader=async path=>{
      const result=await get(path);
      if(tamper==='author'&&!Array.isArray(result))result.user.login='intruder';
      return result;
    };
    const req={...request,get:authorized(event,reader),post:async(_path,data)=>{
      writes++;postedBody=data.body;return {id:42};
    }};
    if(tamper==='none')assert.equal((await runCloudEntry(req)).status,'succeeded');
    else await assert.rejects(runCloudEntry(req),/read-back/);
    assert.equal(writes,1);
  }
});

test('incomplete bounded comment audit fails closed without posting',async()=>{
  let reads=0,writes=0;
  await assert.rejects(runCloudEntry({...request,get:authorized(event,async()=>{
    reads++;return Array.from({length:100},()=>({body:'discussion'}));
  }),post:async()=>{writes++;}}),/audit limit/);
  assert.equal(reads,10);
  assert.equal(writes,0);
});

test('stale executor and changed issue state fail before a receipt mutation',async()=>{
  for(const scenario of ['stale-admission','main-moved','issue-edited','issue-closed']){
    let mainReads=0,issueReads=0,writes=0;
    const get=async path=>{
      if(path.endsWith('/git/ref/heads/main')){
        mainReads++;
        const moved=scenario==='stale-admission'||(scenario==='main-moved'&&mainReads===2);
        return {object:{sha:moved?'b'.repeat(40):EXECUTOR_SHA}};
      }
      if(path==='/repos/'+REPOSITORY+'/issues/17'){
        issueReads++;
        if(scenario==='issue-edited'&&issueReads===1)
          return {...event.issue,state:'open',body:event.issue.body+' edited'};
        if(scenario==='issue-closed'&&issueReads===2)
          return {...event.issue,state:'closed'};
        return {...event.issue,state:'open'};
      }
      if(path.endsWith('/issues/17/comments?per_page=100&page=1'))return [];
      throw Error('Unexpected read '+path);
    };
    await assert.rejects(runCloudEntry({...request,get,post:async()=>{writes++;}}),
      /current main|lost current-main lease|changed or closed/);
    assert.equal(writes,0);
  }
});

test('cloud entry refuses to execute when exact executor identity is missing',async()=>{
  let reads=0;
  await assert.rejects(runCloudEntry({...request,executorSha:null,get:async()=>{reads++;}}),
    /Executor SHA is required/);
  assert.equal(reads,0);
});

test('failed attempts and successful receipts for another task do not block a safe retry',async()=>{
  for(const [prior,expectedOrdinal] of [
    await executeCloudTask({repository:REPOSITORY,issueNumber:17,objective:'/repo inspect'},
      {get:async()=>{throw Error('Unavailable');}}).then(value=>[value,2]),
    await executeCloudTask({repository:REPOSITORY,issueNumber:17,objective:'/help'},
      {get:async()=>{}}).then(value=>[value,1]),
  ]){
    let postedBody;
    const activeEvent={...event,issue:{...event.issue,body:'ULTRON_CLOUD_V1\n/repo inspect'}};
    const outcome=await runCloudEntry({...request,event:activeEvent,
      get:authorized(activeEvent,async path=>{
        if(path.includes('/issues/comments/'))return receiptComment(postedBody);
        if(path.includes('/comments?'))return [receiptComment(formatReceipt(prior))];
        if(path.includes('/git/commits/'))return {tree:{sha:'b'.repeat(40)}};
        if(path.includes('/git/trees/'))return {truncated:false,tree:[]};
        throw Error('Unexpected request');
      }),
      post:async(_path,data)=>{postedBody=data.body;return {id:42};}});
    assert.equal(outcome.status,'succeeded');
    assert.equal(outcome.attemptOrdinal,expectedOrdinal);
    assert.ok(postedBody);
  }
});

test('matching failed attempts have a bounded retry budget and duplicate comments do not consume it',async()=>{
  const retryEvent={...event,issue:{...event.issue,body:'ULTRON_CLOUD_V1\n/repo inspect'}};
  const retryRequest={...request,event:retryEvent};
  const failed=await executeCloudTask({repository:REPOSITORY,issueNumber:17,objective:'/repo inspect'},
    {get:async()=>{throw Error('Unavailable');},runId:'123',runAttempt:1});
  const comments=[receiptComment(formatReceipt(failed),1),receiptComment(formatReceipt(failed),2)];
  for(let ordinal=2;ordinal<=MAX_TASK_ATTEMPTS;ordinal++){
    let postedBody;
    const result=await runCloudEntry({...retryRequest,runId:String(123+ordinal),
      get:authorized(retryEvent,async path=>{
      if(path.includes('/issues/comments/'))return receiptComment(postedBody,40+ordinal);
      if(path.includes('/git/'))throw Error('Unavailable');
      return comments;
    }),post:async(_path,data)=>{postedBody=data.body;return {id:40+ordinal};}});
    assert.equal(result.attemptOrdinal,ordinal);
    comments.push(receiptComment(postedBody,ordinal));
  }
  let writes=0;
  const exhausted=await runCloudEntry({...retryRequest,get:authorized(retryEvent,async()=>comments),
    post:async()=>{writes++;}});
  assert.equal(exhausted.status,'retry-exhausted');
  assert.equal(exhausted.retry.attemptsUsed,MAX_TASK_ATTEMPTS);
  assert.equal(writes,0);
});

test('a prior terminal block cannot be replayed into an execution',async()=>{
  const blocked=await executeCloudTask({repository:REPOSITORY,issueNumber:17,
    objective:'do something unsupported'},{get:async()=>{}});
  let writes=0;
  const activeEvent={...event,issue:{...event.issue,body:'ULTRON_CLOUD_V1\ndo something unsupported'}};
  const result=await runCloudEntry({...request,event:activeEvent,
    get:authorized(activeEvent,async()=>[receiptComment(formatReceipt(blocked))]),
    post:async()=>{writes++;}});
  assert.equal(result.status,'blocked');
  assert.equal(result.retry.disposition,'terminal');
  assert.equal(writes,0);
});

test('all failed reads are failed; mixed reads are partial; receipt records executor provenance',async()=>{
  const task={repository:REPOSITORY,issueNumber:null,objective:'/repo inspect'};
  const get=async()=>{throw Error('API unavailable');};
  const failed=await executeCloudTask(task,{get,executorSha:'c'.repeat(40),runId:'123',runAttempt:2});
  assert.equal(failed.status,'failed');
  assert.equal(failed.executorSha,'c'.repeat(40));
  assert.equal(failed.runAttempt,2);
  assert.equal(failed.attemptOrdinal,1);
  assert.equal(failed.attemptLimit,MAX_TASK_ATTEMPTS);
  assert.equal(failed.retry.disposition,'eligible');
  assert.equal(failed.runUrl,'https://github.com/'+REPOSITORY+'/actions/runs/123');
  const partial=await executeCloudTask({...task,objective:'/system status and /repo inspect'},{get});
  assert.equal(partial.status,'partial');
});

test('CLI failure produces a failed Actions exit code while preserving the summary',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ultron-cloud-cli-'));
  try{
    const eventPath=join(directory,'event.json'),summaryPath=join(directory,'summary.md');
    await writeFile(eventPath,JSON.stringify({inputs:{objective:'/repo inspect'}}));
    const preload='data:text/javascript,'+encodeURIComponent(
      `globalThis.fetch=async u=>String(u).endsWith('/git/ref/heads/main')?`+
      `{ok:true,json:async()=>({object:{sha:'${'c'.repeat(40)}'}})}:{ok:false,status:503};`);
    await assert.rejects(promisify(execFile)(process.execPath,['--import',preload,'src/cloud-entry.mjs'],{
      cwd:new URL('..',import.meta.url),env:{...process.env,GITHUB_TOKEN:'test-only',
        GITHUB_EVENT_PATH:eventPath,GITHUB_EVENT_NAME:'workflow_dispatch',
        GITHUB_ACTOR:'michaeljwilliams0123',GITHUB_REPOSITORY:REPOSITORY,
        GITHUB_SHA:'c'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_STEP_SUMMARY:summaryPath},
    }),error=>error.code===1&&/"status":"failed"/.test(error.stdout));
    assert.match(await readFile(summaryPath,'utf8'),/Status:\*\* failed/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
