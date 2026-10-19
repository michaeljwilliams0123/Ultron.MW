import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOwnerFeedback,joinCloudFeedback,evaluateCloudFeedback,
  suggestionFor } from '../src/cloud-feedback.mjs';
import { parseTask,observeCloudHistory,executeCloudTask,formatReceipt,
  REPOSITORY } from '../src/cloud-cycle.mjs';
import { runCloudEntry } from '../src/cloud-entry.mjs';

const owner='michaeljwilliams0123', SHA='a'.repeat(40),TREE='b'.repeat(40);
const date=i=>new Date(Date.UTC(2026,9,19,12,i)).toISOString();
const comment=(id,who,body,minute=10)=>({id,user:{login:who},body,created_at:date(minute)});
const feedback=(id,runId,rating,minute=15)=>comment(id,owner,
  'ULTRON_FEEDBACK_V1\nrun:'+runId+':1\nrating:'+rating,minute);
const attempt=(number=17,runId='123',command='/repo inspect')=>({
  key:runId+':1',comment:comment(40,'github-actions[bot]','receipt',10),
  receipt:{issueNumber:number,status:'succeeded',runId,runAttempt:1,
    receipts:[{command,status:'succeeded'}]}
});
const issue=(n=17,objective='/repo inspect')=>({
  number:n,user:{login:owner},title:'[Ultron Cloud] Objective',
  body:'ULTRON_CLOUD_V1\n'+objective,state:'open'
});

test('owner-only exact ratings bind to one later verified bot receipt',()=>{
  const item=attempt();
  const comments=[
    feedback(41,'123','helpful',11),
    feedback(42,'123','not-helpful',12), // newer owner correction wins
    comment(43,'another-user','ULTRON_FEEDBACK_V1\nrun:123:1\nrating:helpful',13),
    feedback(39,'123','helpful',9), // older than receipt
    feedback(44,'different','helpful',14),
  ];
  const result=joinCloudFeedback({issueNumber:17,attempts:[item],comments});
  assert.equal(result.length,1);
  assert.equal(result[0].rating,'not-helpful');
  assert.equal(result[0].feedbackCommentId,42);
  assert.equal(parseOwnerFeedback(comments[2]),null);
  assert.equal(parseOwnerFeedback(comment(50,owner,'ULTRON_FEEDBACK_V1\nrun:123:1\nrating:helpful\nextra')),null);
  assert.equal(joinCloudFeedback({issueNumber:18,attempts:[item],comments}).length,0);
  assert.equal(joinCloudFeedback({issueNumber:17,attempts:[{
    ...item,key:'wrong:1',
  }],comments}).length,0);
});

test('only independently successful single supported commands enter owner-rated dataset',()=>{
  const original=attempt();
  for(const receipt of [
    {...original.receipt,status:'failed'},
    {...original.receipt,receipts:[{command:'/repo inspect',status:'failed'}]},
    {...original.receipt,receipts:[
      {command:'/repo inspect',status:'succeeded'},
      {command:'/system status',status:'succeeded'}]},
    {...original.receipt,receipts:[{command:'/unknown',status:'succeeded'}]},
  ]){
    assert.equal(joinCloudFeedback({issueNumber:17,
      attempts:[{...original,receipt}],comments:[feedback(50,'123','helpful')]}).length,0);
  }
});

function outcomeFixture() {
  const arr=[];
  for(let i=0;i<24;i++){
    const negative=i<18 ? i%3===0 : i%2===0;
    const command=negative?'/repo inspect':'/help';
    arr.push({issueNumber:i+10,command,
      rating:negative?'not-helpful':'helpful',
      receiptKey:'run'+i+':1',feedbackCommentId:i+100,
      at:date(i)});
  }
  return arr;
}
test('cloud feedback trains earlier observations and checks later held-out ratings',()=>{
  const r=evaluateCloudFeedback(outcomeFixture());
  assert.equal(r.qualifiedExperiences,24);
  assert.equal(r.training,18);
  assert.equal(r.heldout,6);
  assert.equal(r.status,'validated');
  assert.equal(r.adopted,true);
  assert.equal(r.regressions,0);
  assert.ok(r.delta>=.05);
  assert.deepEqual(r.candidate.cautionCommands,['/repo inspect']);
  assert.equal(suggestionFor('/repo inspect',r).advisory,'owner-reported-low-usefulness');
  assert.equal(suggestionFor('/system status',r).advisory,'no-measured-objection');
  assert.equal(suggestionFor('/delete',r).executable,false);
  assert.equal(suggestionFor('/repo inspect',r).executable,false);
});

test('regressions and insufficient evidence never produce a learned policy',()=>{
  assert.equal(evaluateCloudFeedback([]).status,'insufficient-evidence');
  assert.equal(evaluateCloudFeedback(outcomeFixture().slice(0,10)).adopted,false);
  const noNeg=outcomeFixture().map(x=>({...x,rating:'helpful'}));
  assert.equal(evaluateCloudFeedback(noNeg).status,'insufficient-diversity');
  const bad=outcomeFixture().map(x=>({...x}));
  // Held-out success on an older poorly rated command causes a newly wrong
  // abstention; no candidate can adopt despite some other improvements.
  bad[20].rating='helpful';
  const r=evaluateCloudFeedback(bad);
  assert.equal(r.adopted,false);
  assert.ok(r.regressions>=1);
  assert.equal(r.activeVersion,'baseline');
  const same=evaluateCloudFeedback(outcomeFixture());
  assert.equal(same.evidenceHash,evaluateCloudFeedback(outcomeFixture()).evidenceHash);
});

test('owner issue_comment events evaluate learning but cannot dispatch new write actions',()=>{
  const event={action:'created',issue:issue(),
    comment:feedback(55,'123','helpful')};
  assert.equal(parseTask(event,'issue_comment',owner,REPOSITORY).objective,
    '/learning status');
  assert.throws(()=>parseTask({...event,comment:comment(55,'another','ULTRON_FEEDBACK_V1\nrun:123:1\nrating:helpful')},
    'issue_comment',owner,REPOSITORY),/Invalid owner feedback/);
  assert.throws(()=>parseTask({...event,issue:{...event.issue,pull_request:{}}},
    'issue_comment',owner,REPOSITORY),/Invalid owner feedback/);
  assert.throws(()=>parseTask({...event,comment:comment(55,owner,'deploy all')},
    'issue_comment',owner,REPOSITORY),/Invalid owner feedback/);
});

async function receiptFor(n=17,runId='123') {
  const task={repository:REPOSITORY,issueNumber:n,objective:'/repo inspect'};
  const outcome=await executeCloudTask(task,{get:async path=>{
    if(path.endsWith('/git/ref/heads/main'))return {object:{sha:SHA}};
    if(path.endsWith('/git/commits/'+SHA))return {tree:{sha:TREE}};
    if(path.endsWith('/git/trees/'+TREE+'?recursive=1'))
      return {truncated:false,tree:[{type:'blob',path:'src/cloud-cycle.mjs'}]};
    throw Error('Unexpected mock GitHub request');
  },executorSha:SHA,runId,runAttempt:1});
  return formatReceipt({...outcome,sourceAuthority:{
    executorSha:SHA,admittedMainSha:SHA,preReceiptMainSha:SHA,
  }});
}
test('cloud observation joins real receipt provenance to owner rating with no fabricated promotion',async()=>{
  const receipt=await receiptFor();
  const get=async path=>{
    if(path.includes('/issues?state=all&per_page=100&page='))return [issue()];
    if(path.includes('/issues/17/comments?per_page=100&page='))return [
      comment(40,'github-actions[bot]',receipt,10),
      feedback(41,'123','helpful',11),
      comment(42,'attacker','ULTRON_FEEDBACK_V1\nrun:123:1\nrating:not-helpful',12),
    ];
    throw Error('Unexpected mock fetch '+path);
  };
  const evidence=await observeCloudHistory(get);
  assert.equal(evidence.verifiedTasks,1);
  assert.equal(evidence.qualifiedExperiences,1);
  assert.deepEqual(evidence.ownerRatings,{helpful:1,notHelpful:0});
  assert.equal(evidence.unratedTasks,0);
  assert.equal(evidence.feedbackEvaluation.status,'insufficient-evidence');
  assert.equal(evidence.promotions,0);
  assert.equal(evidence.feedbackEvaluation.adopted,false);
});

test('rating-triggered cloud evaluation is read-only except for prior task receipt paths',async()=>{
  const event={action:'created',issue:issue(),comment:feedback(55,'123','helpful')};
  const receipt=await receiptFor();
  let writes=0;
  const result=await runCloudEntry({event,eventName:'issue_comment',
    actor:owner,repository:REPOSITORY,executorSha:SHA,
    get:async path=>{
      if(path.endsWith('/git/ref/heads/main'))return {object:{sha:SHA}};
      if(path.includes('/issues?state=all&per_page=100&page='))return [issue()];
      if(path.includes('/issues/17/comments?per_page=100&page='))return [
        comment(40,'github-actions[bot]',receipt,10),
        feedback(55,'123','helpful',11)];
      throw Error('Unexpected GitHub GET '+path);
    },
    post:async()=>{writes++;throw Error('Writes not authorized for feedback');},
  });
  assert.equal(result.status,'succeeded');
  assert.equal(result.receipts[0].details.qualifiedExperiences,1);
  assert.equal(writes,0);
});
