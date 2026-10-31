import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTINUUM_ISSUES, selectCouncilReviews, readCouncilActivity} from '../src/continuum-supervisor.mjs';

const now='2026-11-01T12:00:00Z';
const item=(number,extra={})=>({number,state:'open',lastReviewAt:null,lastMeaningfulAt:'2026-10-31T12:00:00Z',...extra});

test('supervisor has a bounded exact roadmap scope',()=>{
  assert.deepEqual(CONTINUUM_ISSUES,Array.from({length:13},(_,i)=>183+i));
});

test('dispatch only open issues that have no council review yet',()=>{
  const picked=selectCouncilReviews([item(183),item(184,{state:'closed'}),item(195)],{now,limit:2});
  assert.deepEqual(picked,[183,195]);
});

test('a new owner issue comment triggers review sooner than stale refresh',()=>{
  const selected=selectCouncilReviews([
    item(183,{lastReviewAt:'2026-11-01T10:00:00Z',lastMeaningfulAt:'2026-11-01T11:00:00Z'}),
    item(184,{lastReviewAt:'2026-11-01T10:00:00Z',lastMeaningfulAt:'2026-10-31T12:00:00Z'})
  ],{now});
  assert.deepEqual(selected,[183]);
});

test('repeated council bot reports without meaningful owner changes are not continually redispatched',()=>{
  const picked=selectCouncilReviews([item(184,{lastReviewAt:'2026-11-01T11:50:00Z',lastMeaningfulAt:'2026-10-31T12:00:00Z'})],{now});
  assert.deepEqual(picked,[]);
});

test('stale reports are selected oldest-first with max concurrency and no closed issue',()=>{
  const picked=selectCouncilReviews([
    item(183,{lastReviewAt:'2026-10-31T08:00:00Z'}),
    item(184,{lastReviewAt:'2026-10-31T07:00:00Z'}),
    item(185,{lastReviewAt:'2026-10-31T09:00:00Z'}),
    item(186,{state:'closed'})
  ],{now,limit:2,refreshHours:24});
  assert.deepEqual(picked,[184,183]);
});

test('refuse out-of-scope and invalid time/limits before dispatch',()=>{
  assert.throws(()=>selectCouncilReviews([item(196)],{now}),/out-of-scope/);
  assert.throws(()=>selectCouncilReviews([item(183)],{now,limit:0}),/limit-invalid/);
  assert.throws(()=>selectCouncilReviews([item(183)],{now:'not-time'}),/time-invalid/);
});

test('supervisor grants only actions dispatch, never administration or secret access',()=>{
  const yml=readFileSync(new URL('../.github/workflows/continuum-council-supervisor.yml',import.meta.url),'utf8');
  assert.match(yml,/schedule:/);
  assert.match(yml,/workflow_dispatch:/);
  assert.match(yml,/\bactions: write\b/);
  assert.match(yml,/\bissues: read\b/);
  assert.doesNotMatch(yml,/administration: write|contents: write|issues: write|pull-requests: write|secrets: inherit|OPENAI_API_KEY|pull_request_target/);
  assert.match(yml,/council-debate\.yml/);
  assert.match(yml,/src\/continuum-supervisor\.mjs/);
});

test('scan backward past the final comment page to find last genuine council report',async()=>{
  const bot=(at)=>({user:{login:'github-actions[bot]'},body:'# Ultron Council Report\nreview',created_at:at});
  const owner=(at)=>({user:{login:'michaeljwilliams0123'},body:'Owner changed scope',created_at:at});
  const pages={3:[{user:{login:'someone'},body:'noise'}],2:[owner('2026-10-31T09:00:00Z'),bot('2026-10-31T10:00:00Z')],1:[bot('2026-10-30T08:00:00Z')]};
  const calls=[];
  const result=await readCouncilActivity({
    issue:{comments:205,created_at:'2026-10-29T08:00:00Z'},
    owner:'michaeljwilliams0123',
    fetchPage:async page=>{calls.push(page);return pages[page]||[];}
  });
  assert.deepEqual(calls,[3,2]);
  assert.equal(result.complete,true);
  assert.equal(result.lastReviewAt,'2026-10-31T10:00:00Z');
  assert.equal(result.lastMeaningfulAt,'2026-10-29T08:00:00Z');
});

test('owner change after older report is retained even across page boundary',async()=>{
  const result=await readCouncilActivity({
    issue:{comments:205,created_at:'2026-10-29T08:00:00Z'},
    owner:'michaeljwilliams0123',
    fetchPage:async page=>page===3?[{user:{login:'michaeljwilliams0123'},body:'Change',created_at:'2026-10-31T11:00:00Z'}]:
      page===2?[{user:{login:'github-actions[bot]'},body:'# Ultron Council Report',created_at:'2026-10-31T10:00:00Z'}]:[]
  });
  assert.equal(result.complete,true);
  assert.equal(result.lastMeaningfulAt,'2026-10-31T11:00:00Z');
});

test('never treat a truncated comment history as no review',async()=>{
  const result=await readCouncilActivity({
    issue:{comments:1100,created_at:'2026-10-29T08:00:00Z'},
    owner:'michaeljwilliams0123',maxPages:2,
    fetchPage:async()=>[]
  });
  assert.equal(result.complete,false);
});

test('manual council dispatch fetches actual issue context, not generic placeholder text',()=>{
  const yml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
  assert.match(yml,/github\.rest\.issues\.get/);
  assert.match(yml,/context\.eventName === 'workflow_dispatch'/);
  assert.doesNotMatch(yml,/body = 'workflow_dispatch owner-first'/);
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runDispatchExtraction({number=183,isPr='false',body='issue body',comments=[]}={}) {
  const yml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
  const match=yml.match(/- name: Extract context[^\n]*\n[\s\S]*?\n          script: \|\n([\s\S]*?)\n      - name: Run owner-first council debate/);
  assert.ok(match,'workflow extraction script exists');
  const source=match[1].split('\n').map(line=>line.replace(/^ {12}/,'')).join('\n');
  const files=new Map();
  const exports=new Map();
  const requireMock=(name)=>name==='fs'
    ? {mkdirSync(){},writeFileSync(path,value){files.set(path,value);}}
    : name==='path' ? {join:(...parts)=>parts.join('/')} : (()=>{throw Error('unexpected require');})();
  const context={actor:'github-actions[bot]',eventName:'workflow_dispatch',repo:{owner:'michaeljwilliams0123',repo:'Ultron.MW'},payload:{inputs:{item_number:String(number),is_pr:isPr}}};
  const github={rest:{
    issues:{
      get:async()=>({data:{number,state:'open',title:'Roadmap',body,comments:comments.length,...(number===196?{pull_request:{url:'https://api.github.com/pulls/196'}}:{})}}),
      listComments:async()=>({data:comments})
    },
    pulls:{get:async()=>({data:{number,state:'open',title:'PR',body}})}
  }};
  const run=new AsyncFunction('require','process','context','github','core',source);
  await run(requireMock,{env:{RUNNER_TEMP:'/tmp'}},context,github,{exportVariable:(key,value)=>exports.set(key,value)});
  return {body:files.get('/tmp/ultron-council/body.txt'),exports};
}

test('manual council dispatch preserves newest owner change within 3000-char baseline',async()=>{
  const result=await runDispatchExtraction({
    body:'A'.repeat(6000),
    comments:[{user:{login:'michaeljwilliams0123'},body:'LATEST-OWNER-CHANGE-REQUIRES-REVIEW'}]
  });
  assert.ok(result.body.length<=3000,'baseline truncation must not discard appended owner context');
  assert.match(result.body,/LATEST-OWNER-CHANGE-REQUIRES-REVIEW/);
});

test('manual issue dispatch rejects a pull request number when is_pr=false',async()=>{
  await assert.rejects(runDispatchExtraction({number:196,isPr:'false'}),/Council dispatch target type mismatch/);
});

test('multibyte issue context survives the workflow byte transport and retains the latest owner update',async()=>{
  const result=await runDispatchExtraction({
    body:'界'.repeat(6000),
    comments:[{user:{login:'michaeljwilliams0123'},body:'OWNER-UPDATE-UTF8-MUST-SURVIVE'}]
  });
  // Simulate the workflow's current shell byte cap before council-debate reads BODY.
  const yml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
  const transported=/BODY=\$\(head -c 8000/.test(yml)
    ? Buffer.from(result.body,'utf8').subarray(0,8000).toString('utf8')
    : result.body;
  assert.match(transported.slice(0,3000),/OWNER-UPDATE-UTF8-MUST-SURVIVE/);
});

test('original full issue security context survives owner-update truncation',async()=>{
  const result=await runDispatchExtraction({
    body:'A'.repeat(5000)+' credential ',
    comments:[{user:{login:'michaeljwilliams0123'},body:'routine formatting update'}]
  });
  assert.doesNotMatch(result.body,/credential/,'test must exercise a removed security keyword');
  assert.equal(result.exports.get('ORIGINAL_SECURITY_SIGNAL'),'1');
});
