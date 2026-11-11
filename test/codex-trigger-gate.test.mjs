import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexCall, formatCodexCall } from '../src/codex-call.mjs';
import { assessCodexTrigger } from '../src/codex-trigger-gate.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const MAIN='a'.repeat(40);
const HEAD='b'.repeat(40);
const call=buildCodexCall({issueNumber:77,sourceSha:MAIN,
  objective:'/codex destiny-codex Inspect public author registry'});
const clean=()=>({
  repository:REPO,actor:OWNER,mainSha:MAIN,
  bindingFingerprint:call.bindingFingerprint,
  event:{action:'created',comment:{id:123,user:{login:OWNER},
    body:'/codex run destiny-codex'},
    issue:{number:78,state:'open',pull_request:{url:'https://api.github.com/repos/'+REPO+'/pulls/78'}}},
  pr:{number:78,state:'open',merged:false,user:{login:'github-actions[bot]'},
    title:'[Ultron Codex] destiny-codex · issue 77',
    body:'## Ultron issue #77\n'+formatCodexCall(call),
    head:{ref:'ultron/issue-77',sha:HEAD,repo:{full_name:REPO}},
    base:{ref:'main',repo:{full_name:REPO}}},
  issue:{number:77,state:'open',user:{login:OWNER},
    title:'[Ultron PR] Create proposal',
    body:'ULTRON_PR_V1\n'+call.request},
  proposalText:formatCodexCall(call),
  ownerTriggerCount:1,ownerTriggerIds:[123],
  claimState:'missing',receiptState:'missing',
});

test('valid owner comment is verified GitHub transport, NEVER proof of Destiny execution',()=>{
  const a=assessCodexTrigger(clean());
  assert.equal(a.state,'transport-observed-executor-unverified');
  assert.equal(a.reason,'await-independent-executor-receipt');
  assert.equal(a.taskId,call.taskId);
  assert.equal(a.sourceSha,MAIN);
  assert.equal(a.prHeadSha,HEAD);
  assert.equal(a.externalExecutionVerified,false);
  assert.equal(a.workAccountAuthenticated,false);
  assert.equal(a.productionAccepted,false);
  assert.equal('dispatch' in a,false);
});

test('a prior claim or completion record requires reconciliation rather than replay',()=>{
  for(const values of [
    {claimState:'present'},
    {receiptState:'present'},
    {claimState:'unknown'},
    {receiptState:'unknown'},
    {ownerTriggerCount:2},
  ]){
    const a=assessCodexTrigger({...clean(),...values});
    assert.equal(a.state,'reconcile-required');
    assert.equal(a.externalExecutionVerified,false);
  }
});

test('closed PR, stale source or changed request fail closed',()=>{
  for(const delta of [
    {mainSha:'c'.repeat(40)},
    {pr:{...clean().pr,state:'closed'}},
    {issue:{...clean().issue,body:'ULTRON_PR_V1\nchanged'}},
    {proposalText:'tampered proposal envelope'},
    {bindingFingerprint:'f'.repeat(64)},
  ]){
    const a=assessCodexTrigger({...clean(),...delta});
    assert.equal(a.state,'held');
    assert.equal(a.externalExecutionVerified,false);
  }
});

test('owner spoofing, unrelated PR and untrusted command never enter dispatch',()=>{
  for(const delta of [
    {actor:'attacker'},
    {event:{...clean().event,comment:{...clean().event.comment,
      user:{login:'attacker'}}}},
    {event:{...clean().event,issue:{...clean().event.issue,number:79}}},
    {event:{...clean().event,comment:{...clean().event.comment,
      body:'/codex run destiny-codex extra'}}},
    {event:{...clean().event,action:'edited'}},
    {repository:'attacker/Ultron.MW'},
    {event:{...clean().event,comment:{...clean().event.comment,body:'@ultron verify'}}},
  ]){
    const a=assessCodexTrigger({...clean(),...delta});
    assert.equal(a.state,'held');
  }
});

test('invalid comment counts cannot be admitted as a first trigger',()=>{
  for(const ownerTriggerCount of [-1,0,1.5,101]){
    assert.equal(assessCodexTrigger({...clean(),ownerTriggerCount}).state,'held');
  }
});

test('owner Codex command has its own GitHub event audit, not generic PR conversation',async()=>{
  const {readFile}=await import('node:fs/promises');
  const owner=await readFile(new URL('../.github/workflows/owner-comment-router.yml',import.meta.url),'utf8');
  const audit=await readFile(new URL('../.github/workflows/codex-trigger-audit.yml',import.meta.url),'utf8');
  assert.match(owner,/!startsWith\(github\.event\.comment\.body, '\/codex run '\)/);
  assert.match(audit,/issue_comment:/);
  assert.match(audit,/node scripts\/codex-trigger-audit\.mjs/);
  assert.match(audit,/pull-requests: read/);
  assert.doesNotMatch(audit,/contents: write|pull-requests: write|actions: write|issues: write/);
});

test('trigger identity is bound to the exact authenticated GitHub comment ID',()=>{
  for(const ownerTriggerIds of [[],[124],[123,124],[123,123],null]){
    const result=assessCodexTrigger({...clean(),ownerTriggerIds});
    assert.equal(result.state,'held');
    assert.equal(result.externalExecutionVerified,false);
  }
});

test('bare mentions do not enter C03, while explicit named owner commands preserve replay checks', () => {
  for (const body of ['@michaeljwilliams0123ultron','@ultron-codex',
    '@destiny-codex','@michaeljwilliams0123ultron do something else',
    '@ultron-codex ','Please @ultron-codex','@mike-codex','@unregistered']) {
    const input=clean();input.event.comment.body=body;
    assert.equal(assessCodexTrigger(input).state,'held',body);
  }
  for (const body of ['/codex run destiny-codex',
    '/codex run michaeljwilliams0123ultron','/codex run ultron-codex']) {
    const input=clean();input.event.comment.body=body;
    assert.equal(assessCodexTrigger(input).state,'transport-observed-executor-unverified',body);
    input.ownerTriggerCount=2;
    assert.equal(assessCodexTrigger(input).state,'reconcile-required',body);
  }
  const input=clean();input.event.comment.body='/codex run destiny-codex';
  input.event.comment.user.login='outsider';
  assert.equal(assessCodexTrigger(input).state,'held');
});
