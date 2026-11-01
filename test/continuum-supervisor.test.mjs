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
  const pages={3:[{user:{login:'someone'},body:'noise'}],2:[
    owner('2026-10-31T09:00:00Z'),
    ...Array.from({length:98},(_,i)=>({user:{login:'someone'},body:'noise '+i})),
    bot('2026-10-31T10:00:00Z')
  ],1:[bot('2026-10-30T08:00:00Z')]};
  const calls=[];
  const result=await readCouncilActivity({
    issue:{comments:201,created_at:'2026-10-29T08:00:00Z'},
    owner:'michaeljwilliams0123',
    fetchPage:async page=>{calls.push(page);return pages[page]||[];}
  });
  assert.deepEqual(calls,[4,3,2]);
  assert.equal(result.complete,true);
  assert.equal(result.lastReviewAt,'2026-10-31T10:00:00Z');
  assert.equal(result.lastMeaningfulAt,'2026-10-29T08:00:00Z');
});

test('owner change after older report is retained even across page boundary',async()=>{
  const result=await readCouncilActivity({
    issue:{comments:201,created_at:'2026-10-29T08:00:00Z'},
    owner:'michaeljwilliams0123',
    fetchPage:async page=>page===3?[{user:{login:'michaeljwilliams0123'},body:'Change',created_at:'2026-10-31T11:00:00Z'}]:
      page===2?[
      {user:{login:'github-actions[bot]'},body:'# Ultron Council Report',created_at:'2026-10-31T10:00:00Z'},
      ...Array.from({length:99},()=>({user:{login:'someone'},body:'noise'}))
    ]:[]
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

async function runDispatchExtraction({number=183,isPr='false',body='issue body',title='Roadmap',comments=[],eventName='workflow_dispatch'}={}) {
  const yml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
  const match=yml.match(/- name: Extract context[^\n]*\n[\s\S]*?\n          script: \|\n([\s\S]*?)\n      - name: Run owner-first council debate/);
  assert.ok(match,'workflow extraction script exists');
  const source=match[1].split('\n').map(line=>line.replace(/^ {12}/,'')).join('\n');
  const files=new Map();
  const exports=new Map();
  const requireMock=(name)=>name==='fs'
    ? {mkdirSync(){},writeFileSync(path,value){files.set(path,value);}}
    : name==='path' ? {join:(...parts)=>parts.join('/')} : (()=>{throw Error('unexpected require');})();
  const payload=eventName==='workflow_dispatch' ? {inputs:{item_number:String(number),is_pr:isPr}} :
    eventName==='issues' ? {issue:{number,title,body}} :
    eventName==='pull_request' ? {pull_request:{number,title,body}} :
    {issue:{number,title,body},comment:{body}};
  const context={actor:'github-actions[bot]',eventName,repo:{owner:'michaeljwilliams0123',repo:'Ultron.MW'},payload};
  const github={rest:{
    issues:{
      get:async()=>({data:{number,state:'open',title,body,comments:comments.length,...(number===196?{pull_request:{url:'https://api.github.com/pulls/196'}}:{})}}),
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


test('full latest owner update security keyword cannot be hidden after display truncation',async()=>{
 const result=await runDispatchExtraction({
  body:'Normal council request',
  comments:[{user:{login:'michaeljwilliams0123'},body:'A'.repeat(2500)+' credential escalation'}]
 });
 assert.doesNotMatch(result.body,/credential escalation/);
 assert.equal(result.exports.get('ORIGINAL_SECURITY_SIGNAL'),'1',
  'risk scan must include entire owner-authored comment before truncation');
});

test('council title transport does not apply a second UTF-8 byte truncation',()=>{
 const yml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
 assert.doesNotMatch(yml,/TITLE=\$\(head -c 240/);
 assert.match(yml,/TITLE=\$\(cat "\$TITLE_FILE"\)/);
});


test('hourly council supervisor isolates unreadable issue and dispatches a later eligible issue',async()=>{
 const yml=readFileSync(new URL('../.github/workflows/continuum-council-supervisor.yml',import.meta.url),'utf8');
 const fragment=yml.match(/          script: \|\n([\s\S]*?)\n(?=\S|$)/);
 assert.ok(fragment,'supervisor inline script must exist');
 let source=fragment[1].split('\n').map(x=>x.replace(/^ {12}/,'')).join('\n');
 const moduleImport=/const \{CONTINUUM_ISSUES,selectCouncilReviews,readCouncilActivity\}=await import\([\s\S]*?\);/;
 assert.match(source,moduleImport);
 source=source.replace(moduleImport,'const {CONTINUUM_ISSUES,selectCouncilReviews,readCouncilActivity}=deps;');
 const dispatched=[],warnings=[],lookups=[];
 const github={rest:{
  issues:{
   get:async({issue_number})=>{
    lookups.push(issue_number);
    if(issue_number===183)throw Error('simulated unavailable issue');
    return {data:{number:issue_number,state:'open',comments:0}};
   },
   listComments:async()=>({data:[]})
  },
  actions:{createWorkflowDispatch:async args=>{dispatched.push(args);}}
 }};
 const summary={addHeading(){return this;},addRaw(){return this;},async write(){}};
 const core={info(){},warning:msg=>warnings.push(msg),summary};
 const deps={
  CONTINUUM_ISSUES:[183,184,185],
  selectCouncilReviews:rows=>rows.map(x=>x.number).slice(0,2),
  readCouncilActivity:async()=>({complete:true,lastReviewAt:null,lastMeaningfulAt:null})
 };
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const fn=new AsyncFunction('require','process','context','github','core','deps',source);
 await fn(name=>{if(name==='node:url')return {pathToFileURL:()=>({href:'mock'})};if(name==='node:path')return {join:()=>''};throw Error('unexpected require')},
  {env:{GITHUB_WORKSPACE:'/tmp'}},{repo:{owner:'michaeljwilliams0123',repo:'Ultron.MW'}},
  github,core,deps);
 assert.deepEqual(lookups,[182,183,184,185]);
 assert.deepEqual(dispatched.map(x=>Number(x.inputs.item_number)),[184,185]);
 assert.equal(warnings.length,1);
 assert.match(warnings[0],/#183/);
});


test('full issue title risk word after display cap still marks original security context',async()=>{
 const title='A'.repeat(240)+' credential';
 assert.ok(title.length<=256);
 const result=await runDispatchExtraction({title,body:'Routine planning update'});
 assert.equal(result.exports.get('ORIGINAL_SECURITY_SIGNAL'),'1',
  'the undisplayed suffix of a GitHub title must influence security hold');
});


test('owner council commands enter council workflow without conflicting PR-brain execution',()=>{
 const yml=readFileSync(new URL('../.github/workflows/owner-comment-router.yml',import.meta.url),'utf8');
 const prRoute=yml.split('  pr-conversation:')[1]?.split('  council-command:')[0];
 const councilRoute=yml.split('  council-command:')[1]||'';
 assert.ok(prRoute);
 assert.match(prRoute,/!startsWith\(github\.event\.comment\.body, '\/council'\)/,
  'owner /council command should not trigger nonadmitted PR-brain job');
 assert.match(councilRoute,/startsWith\(github\.event\.comment\.body, '\/council'\)/);
});


test('council routing matches leading commands, not incidental file paths',()=>{
 const yml=readFileSync(new URL('../.github/workflows/owner-comment-router.yml',import.meta.url),'utf8');
 const prRoute=yml.split('  pr-conversation:')[1]?.split('  council-command:')[0]||'';
 const councilRoute=yml.split('  council-command:')[1]||'';
 assert.ok(prRoute);
 assert.ok(councilRoute);
 assert.doesNotMatch(prRoute,/!contains\(github\.event\.comment\.body, '\/council'\)/);
 assert.doesNotMatch(councilRoute,/contains\(github\.event\.comment\.body, '\/council'\)/);
 assert.match(prRoute,/!startsWith\(github\.event\.comment\.body, '\/council'\)/);
 assert.match(councilRoute,/startsWith\(github\.event\.comment\.body, '\/council'\)/);
});

test('owner issue_comment council reports retain pull request identity',()=>{
 const yml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
 const section=yml.split("} else if (context.eventName === 'issue_comment') {")[1]?.split("} else if (context.eventName === 'workflow_dispatch') {")[0]||'';
 assert.match(section,/isPr\s*=\s*issue\.pull_request\s*\?\s*'true'\s*:\s*'false'/);
});

test('RED: non-dispatch issue, PR and owner-comment events export full security classification',async()=>{
  for(const eventName of ['issues','pull_request','issue_comment']){
    const result=await runDispatchExtraction({
      eventName,title:'Routine review',body:'A'.repeat(8100)+' credential exposure'
    });
    assert.equal(result.exports.get('ORIGINAL_SECURITY_SIGNAL'),'1',
      eventName+' must classify full untruncated event content');
  }
  const benign=await runDispatchExtraction({eventName:'issues',body:'Routine review'});
  assert.equal(benign.exports.get('ORIGINAL_SECURITY_SIGNAL'),'0');
});


test('truncated newest comment page fails closed even when an older council report exists',async()=>{
 const result=await readCouncilActivity({
  issue:{comments:201,created_at:'2026-10-29T08:00:00Z'},
  owner:'michaeljwilliams0123',
  fetchPage:async page=>page===3?[]:[{
   user:{login:'github-actions[bot]'},body:'# Ultron Council Report',
   created_at:'2026-10-31T10:00:00Z'
  }]
 });
 assert.equal(result.complete,false,
  'missing newest page must not authorize duplicate or stale council dispatch');
});


test('partial nonempty newest page cannot certify complete council history',async()=>{
 const result=await readCouncilActivity({
  issue:{comments:201,created_at:'2026-10-29T08:00:00Z'},
  owner:'michaeljwilliams0123',
  fetchPage:async page=>page===3?[{
   user:{login:'github-actions[bot]'},body:'# Ultron Council Report',
   created_at:'2026-10-31T10:00:00Z'
  }]:[]
 });
 assert.equal(result.complete,false,
  'a partial final page can omit newer owner instructions even if it contains a council report');
});

test('comments appended after issue snapshot must not be hidden by stale page count',async()=>{
 const result=await readCouncilActivity({
  issue:{comments:200,created_at:'2026-10-29T08:00:00Z'},
  owner:'michaeljwilliams0123',
  fetchPage:async page=>page===3?[{
   user:{login:'michaeljwilliams0123'},body:'New owner scope',
   created_at:'2026-10-31T11:00:00Z'
  }]:page===2?[{
   user:{login:'github-actions[bot]'},body:'# Ultron Council Report',
   created_at:'2026-10-31T10:00:00Z'
  }]:[]
 });
 assert.equal(result.complete,false,
  'an extra page created after the issue snapshot must force reconciliation before dispatch');
});
