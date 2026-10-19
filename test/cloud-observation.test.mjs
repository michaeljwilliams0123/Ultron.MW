import test from 'node:test';
import assert from 'node:assert/strict';
import { observeCloudHistory,readIssueReceipts,executeCloudTask,
  formatReceipt,REPOSITORY } from '../src/cloud-cycle.mjs';

const SHA='a'.repeat(40), WRONG='b'.repeat(40);
const owner='michaeljwilliams0123';
const issue=(number,objective='/repo inspect')=>({
  number,user:{login:owner},title:'[Ultron Cloud] Objective',
  body:'ULTRON_CLOUD_V1\n'+objective,
});
async function receipt(number,{valid=true,status='succeeded',attempt=1,runId='123'}={}){
  const objective='/repo inspect';
  const task={repository:REPOSITORY,issueNumber:number,objective};
  const result=await executeCloudTask(task,{
    get:async path=>{
      if(status==='failed')throw Error('Read unavailable');
      if(path.endsWith('/git/ref/heads/main'))return {object:{sha:SHA}};
      if(path.endsWith('/git/commits/'+SHA))return {tree:{sha:WRONG}};
      if(path.includes('/git/trees/'+WRONG))return {truncated:false,tree:[]};
      throw Error('Unknown mock request');
    },
    executorSha:SHA,runId,attemptOrdinal:attempt,
  });
  return formatReceipt({...result,sourceAuthority:{
    executorSha:SHA,admittedMainSha:valid?SHA:WRONG,
    preReceiptMainSha:SHA,
  }});
}
const bot=(body,id)=>({id,user:{login:'github-actions[bot]'},body});
function reader(issues,comments={}){
  return async path=>{
    if(path.includes('/issues?state=all&per_page=100&page='))return issues;
    const number=Number(path.match(/\/issues\/(\d+)\/comments/)?.[1]);
    if(Number.isInteger(number))return comments[number]||[];
    throw Error('Unexpected GitHub query '+path);
  };
}

test('cloud learning counts authenticated terminal tasks, not retries, forged comments or PRs',async()=>{
  const completed=await receipt(17,{runId:'200',attempt:2});
  const oldFailed=await receipt(17,{status:'failed',runId:'199'});
  const failed=await receipt(18,{status:'failed',runId:'201'});
  const mismatched=await receipt(18,{valid:false,runId:'202'});
  const count=await observeCloudHistory(reader([
    issue(17),issue(18),{...issue(19),user:{login:'intruder'}},
    {...issue(20),pull_request:{}},issue(21,'send my secret'),
  ],{
    17:[bot(oldFailed,1),bot(completed,2),bot(completed,3),
      {id:4,user:{login:'intruder'},body:completed}],
    18:[bot(failed,5),bot(mismatched,6)],
  }));
  assert.equal(count.ownerTasks,2);
  assert.equal(count.verifiedTasks,2);
  assert.deepEqual(count.outcomes,{succeeded:1,partial:0,failed:1,blocked:0});
  assert.equal(count.invalidReceipts,1);
  assert.equal(count.qualifiedExperiences,0);
  assert.equal(count.promotions,0);
  assert.equal(count.unratedTasks,2);
  assert.equal(count.learningStatus,'no-owner-rated-cloud-outcomes');
});

test('cloud command uses actual GitHub receipt observations and no false promotion',async()=>{
  const audited=await receipt(17);
  const get=reader([issue(17)],{17:[bot(audited,1)]});
  const result=await executeCloudTask({
    repository:REPOSITORY,issueNumber:null,objective:'/learning status',
  },{get});
  assert.equal(result.status,'succeeded');
  assert.equal(result.receipts[0].details.verifiedTasks,1);
  assert.equal(result.receipts[0].details.outcomes.succeeded,1);
  assert.equal(result.receipts[0].details.qualifiedExperiences,0);
  assert.match(result.receipts[0].summary,/1 attested outcome/);
});

test('missing or incomplete GitHub history cannot produce a success claim',async()=>{
  for(const mode of ['unavailable','pagination-limit','comments-incomplete']){
    let reads=0;
    const get=async path=>{
      reads++;
      if(mode==='unavailable')throw Error('GitHub down');
      if(path.includes('/issues?'))return mode==='pagination-limit'
        ? Array.from({length:100},(_,i)=>({number:i+1, title:'unrelated'}))
        : [issue(17)];
      if(mode==='comments-incomplete')return Array.from({length:100},()=>({body:'discussion'}));
      throw Error('Unexpected read');
    };
    await assert.rejects(observeCloudHistory(get),/GitHub down|limit reached/);
    const result=await executeCloudTask({
      repository:REPOSITORY,issueNumber:null,objective:'/learning status',
    },{get});
    assert.equal(result.status,'failed');
    assert.ok(reads>=2);
  }
});

test('one shared receipt audit scans all pages and preserves replay dedup identities',async()=>{
  const outcome=await receipt(17);
  const reads=[];
  const items=await readIssueReceipts(async path=>{
    reads.push(path);
    return path.endsWith('page=1')
      ? Array.from({length:100},()=>({id:4,body:'not a verified receipt'}))
      : [bot(outcome,5),bot(outcome,6)];
  },17);
  assert.equal(reads.length,2);
  assert.equal(items.length,2);
  assert.equal(items[0].key,items[1].key);
  assert.equal(items[0].receipt.issueNumber,17);
});
