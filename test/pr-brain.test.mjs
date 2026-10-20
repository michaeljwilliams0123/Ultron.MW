import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { admitPrTurn,routePrTurn,handlePrConversation,
  needsPrModelRuntime } from '../src/pr-brain.mjs';

const OWNER='michaeljwilliams0123',REPO=OWNER+'/Ultron.MW',ROOT='/repos/'+REPO;
const SHA='a'.repeat(40),OTHER='b'.repeat(40);
const report=[
  '<!-- ULTRON_SELF_SCAN_REPORT_V1 -->',
  '## Findings',
  '| Priority | Code | Evidence | Suggested next action |',
  '| --- | --- | --- | --- |',
  '| high | live-execution-unobserved | No production response verified | Perform authenticated task |',
  '| medium | ci-head-unobserved | CI proof absent | Verify source revision |',
  '## Scanned source',
].join('\n');
function event(body='@ultron findings',inline=false,id=77){
  const base={action:'created',comment:{id,user:{login:OWNER},body}};
  if(inline)return {...base,pull_request:{number:24}};
  return {...base,issue:{number:24,pull_request:{url:'https://api.github.com/pr/24'}}};
}
function fixture(inline=false){
  const state={comments:[],posts:[],history:[],id:800,head:SHA,patches:[],models:[]};
  const pr={number:24,state:'open',body:'<!-- ULTRON_SELF_SCAN_PR_V1 -->',
    head:{ref:'ultron/self-scan-abc',sha:SHA,repo:{full_name:REPO}},
    base:{ref:'main',repo:{full_name:REPO}}};
  const get=async path=>{
    state.history.push(path);
    if(path===ROOT+'/pulls/24')return structuredClone(pr);
    if(path.includes('/comments?per_page=100&page='))return state.comments;
    if(path.includes('/contents/reports/self-scan/current.md?ref='))
      return {encoding:'base64',content:Buffer.from(report).toString('base64')};
    if(path.startsWith(ROOT+'/issues/comments/')||path.startsWith(ROOT+'/pulls/comments/')){
      const num=Number(path.split('/').at(-1));
      return state.comments.find(c=>c.id===num);
    }
    throw Error('Unexpected GET '+path);
  };
  const post=async(path,body)=>{
    state.posts.push({path,body});
    if(path.endsWith('/dispatches'))return {};
    if(path===ROOT+'/issues/24/comments'||
      path.startsWith(ROOT+'/pulls/24/comments/')){
      const c={id:++state.id,body:body.body,user:{login:'github-actions[bot]'}};
      state.comments.push(c);return {id:c.id};
    }
    throw Error('Unexpected POST '+path);
  };
  const patch=async({pr,manifest})=>{
    state.patches.push(manifest);
    return {commitSha:OTHER,paths:['src/example.mjs']};
  };
  const invoke=async(ev)=>handlePrConversation({event:ev,
    eventName:inline?'pull_request_review_comment':'issue_comment',
    actor:OWNER,repository:REPO,get,post,patch,
    generate:async ({objective})=>{state.models.push(objective);
      return {commitSha:OTHER,paths:['src/example.mjs'],model:'test-free-cpu-model'};},
    observeVerify:async ({post,branch})=>{
      await post(ROOT+'/actions/workflows/verify.yml/dispatches',{ref:branch});
      return {state:'pending',conclusion:null};}});
  const add=ev=>state.comments.push(ev.comment);
  return {state,pr,invoke,add,get,post};
}

test('owner-only PR admission rejects issue, external user and bot feedback',()=>{
  assert.equal(admitPrTurn(event(),'issue_comment',OWNER,REPO).number,24);
  assert.equal(admitPrTurn(event('hi',true),'pull_request_review_comment',OWNER,REPO).inline,true);
  assert.throws(()=>admitPrTurn(event(),'issue_comment','other',REPO),/Only owner/);
  assert.throws(()=>admitPrTurn({...event(),issue:{number:24}},'issue_comment',OWNER,REPO),/PR-only|Only owner/);
  assert.throws(()=>admitPrTurn({...event(),comment:{...event().comment,user:{login:'github-actions[bot]'}}},'issue_comment',OWNER,REPO),/Only owner/);
  assert.equal(routePrTurn('normal unrelated owner comment'),null);
  assert.equal(routePrTurn('@ultron status').kind,'status');
  assert.equal(routePrTurn('@ultron address ci-head-unobserved').kind,'address');
  assert.equal(routePrTurn('@ultron patch\n{"objective":"fix"}').kind,'patch');
  for(const body of ['@Ultron implement fix src/example.mjs route',
    '/ultron implement fix src/example.mjs route',
    'Ultron: implement fix src/example.mjs route',
    'implement fix src/example.mjs route'])
    assert.equal(needsPrModelRuntime(body),true);
  assert.equal(needsPrModelRuntime('@ultron status'),false);
});

test('replies in same PR, reads source findings and provides owner conversation memory',async()=>{
  const m=fixture(),ev=event('@ultron findings');
  m.add(ev);
  const first=await m.invoke(ev);
  assert.equal(first.status,'replied');
  assert.equal(first.intent,'findings');
  assert.match(m.state.comments.at(-1).body,/live-execution-unobserved/);
  assert.equal(m.state.posts.filter(x=>x.path===ROOT+'/issues/24/comments').length,1);
  assert.equal(m.state.posts.filter(x=>x.path.endsWith('/dispatches')).length,0);
  const ev2=event('and now?',false,78);
  m.add(ev2);
  const second=await m.invoke(ev2);
  assert.equal(second.intent,'next');
  assert.match(m.state.comments.at(-1).body,/Next candidate/);
});

test('duplicate delivery is idempotent and bot comments cannot loop',async()=>{
  const m=fixture(),ev=event('@ultron status');m.add(ev);
  await m.invoke(ev);
  const again=await m.invoke(ev);
  assert.equal(again.status,'already-replied');
  assert.equal(m.state.posts.length,1);
  const bot={...ev,comment:{...ev.comment,user:{login:'github-actions[bot]'}}};
  await assert.rejects(()=>m.invoke(bot),/Only owner/);
  assert.equal(m.state.posts.length,1);
});

test('inline PR review comments reply in same review thread',async()=>{
  const m=fixture(true),ev=event('@ultron status',true);m.add(ev);
  const output=await m.invoke(ev);
  assert.equal(output.intent,'status');
  assert.ok(m.state.posts.some(x=>x.path===ROOT+'/pulls/24/comments/77/replies'));
  assert.equal(m.state.posts.some(x=>x.path.includes('/issues/24/comments')),false);
});

test('address evidence gap dispatches exact-head Verify without inventing pass',async()=>{
  const m=fixture(),ev=event('@ultron address ci-head-unobserved');m.add(ev);
  const result=await m.invoke(ev);
  assert.equal(result.intent,'address');
  assert.ok(m.state.posts.some(x=>x.path===ROOT+'/actions/workflows/verify.yml/dispatches'&&
    x.body.ref==='ultron/self-scan-abc'));
  assert.match(m.state.comments.at(-1).body,/not yet independently observed/);
  assert.equal(m.state.patches.length,0);
});

test('rescan uses no Issue, and explicit patch queues head verification',async()=>{
  const m=fixture();
  const ev=event('@ultron rescan');m.add(ev);await m.invoke(ev);
  assert.ok(m.state.posts.some(x=>x.path===ROOT+'/actions/workflows/self-scan-pr.yml/dispatches'));
  const patch=event('@ultron patch\n{"objective":"fix","baseSha":"'+SHA+'","changes":[]}',false,99);
  m.add(patch);
  const outcome=await m.invoke(patch);
  assert.equal(outcome.intent,'patch');
  assert.equal(m.state.patches.length,1);
  assert.equal(m.state.posts.filter(x=>x.path.endsWith('/verify.yml/dispatches')).length,1);
  assert.equal(m.state.posts.filter(x=>x.path===ROOT+'/issues').length,0);
});

test('workflow executes only from trusted main and keeps bot reactions out',async()=>{
  const text=await readFile(new URL('../.github/workflows/pr-brain.yml',import.meta.url),'utf8');
  assert.match(text,/pull_request_review_comment/);
  assert.match(text,/issue_comment/);
  assert.match(text,/github.actor == 'michaeljwilliams0123'/);
  assert.match(text,/github.event.issue.pull_request != null/);
  assert.match(text,/ref: main/);
  assert.match(text,/run: node src\/pr-brain\.mjs/);
  assert.match(text,/persist-credentials: false/);
});

test('owner-authored natural language implement delegates to source-grounded model, then dispatches Verify',async()=>{
  const m=fixture();
  const ev=event('@ultron implement fix src/example.mjs to reject stale routes',false,155);
  m.add(ev);
  const result=await m.invoke(ev);
  assert.equal(result.intent,'implement');
  assert.equal(m.state.models.length,1);
  assert.match(m.state.models[0],/reject stale routes/);
  assert.match(m.state.comments.at(-1).body,/source change/);
  assert.ok(m.state.posts.some(p=>p.path===ROOT+'/actions/workflows/verify.yml/dispatches'));
});

test('failed model-generated code is independently observed, reverted once, and retested',async()=>{
  const m=fixture();
  const ev=event('@ultron implement fix docs/core/capabilities.mjs evidence',false,477);
  m.add(ev);
  let observations=0;
  const outcome=await handlePrConversation({
    event:ev,eventName:'issue_comment',actor:OWNER,repository:REPO,
    get:m.get,post:m.post,
    generate:async()=>({commitSha:OTHER,paths:['docs/core/capabilities.mjs'],
      model:'test-local-cpu',rollbackChanges:[{
        path:'docs/core/capabilities.mjs',before:'generated invalid code',
        after:'original correct code'}]}),
    patch:async ({pr,manifest})=>{
      const parsed=JSON.parse(manifest);
      assert.equal(parsed.baseSha,OTHER);
      assert.equal(parsed.changes[0].before,'generated invalid code');
      assert.equal(parsed.changes[0].after,'original correct code');
      return {commitSha:'c'.repeat(40),paths:['docs/core/capabilities.mjs']};
    },
    observeVerify:async({headSha})=>{
      observations++;
      return {state:'completed',conclusion:observations===1?'failure':'success',
        sha:headSha,url:'https://github.com/'+REPO+'/actions/runs/'+observations};
    },
  });
  assert.equal(outcome.intent,'implement');
  assert.equal(observations,2);
  assert.equal(outcome.action.rollback.status,'committed');
  assert.equal(outcome.action.rollback.verify.conclusion,'success');
  assert.match(m.state.comments.at(-1).body,/automatically restored/);
  assert.match(m.state.comments.at(-1).body,/Restored-head Verify: \*\*success\*\*/);
});
test('a verified passing generated patch is not rolled back',async()=>{
  const m=fixture(),ev=event('@ultron implement fix docs/core/capabilities.mjs route',false,501);
  m.add(ev);let attempts=0;
  const outcome=await handlePrConversation({
    event:ev,eventName:'issue_comment',actor:OWNER,repository:REPO,
    get:m.get,post:m.post,
    generate:async()=>({commitSha:OTHER,paths:['src/example.mjs'],
      rollbackChanges:[{path:'src/example.mjs',before:'new',after:'old'}]}),
    patch:async()=>{attempts++;throw Error('must not revert successful patch');},
    observeVerify:async()=>({state:'completed',conclusion:'success',url:'https://github.com/x'}),
  });
  assert.equal(outcome.action.rollback,undefined);
  assert.equal(attempts,0);
});


test('closed or superseded PR comments are ignored without failure or GitHub writes',async()=>{
  const m=fixture(),ev=event('@ultron regress',false,911);
  m.pr.state='closed';m.add(ev);
  const result=await m.invoke(ev);
  assert.equal(result.status,'ignored-closed');
  assert.equal(result.prNumber,24);
  assert.equal(m.state.posts.length,0);
});

test('owner framework build replies only with the committed SHA and independent test evidence',async()=>{
  const m=fixture(),ev=event('@ultron build api telemetry',false,912);
  m.add(ev);
  let received=null,verified=null;
  const outcome=await handlePrConversation({
    event:ev,eventName:'issue_comment',actor:OWNER,repository:REPO,
    get:m.get,post:m.post,patch:async()=>{throw Error('No patch');},
    buildFramework:async args=>{
      received={kind:args.kind,slug:args.slug,head:args.pr.head.sha};
      return {kind:'api',slug:'telemetry',commitSha:OTHER,
        paths:['src/generated/telemetry/api.mjs',
          'test/generated-api-telemetry.test.mjs',
          'docs/integrations/telemetry-api.md']};
    },
    observeVerify:async args=>{verified=args;return {state:'completed',
      conclusion:'success',sha:OTHER,url:'https://github.com/x/actions/runs/21'};},
  });
  assert.equal(outcome.intent,'build');
  assert.deepEqual(received,{kind:'api',slug:'telemetry',head:SHA});
  assert.equal(verified.headSha,OTHER);
  assert.match(m.state.comments.at(-1).body,/Generated API integration/);
  assert.match(m.state.comments.at(-1).body,/Authenticated exact-head Verify: \*\*success\*\*/);
  assert.match(m.state.comments.at(-1).body,new RegExp(OTHER));
});

test('regression routing triggers full Verify without claiming a pending result passed',async()=>{
  const m=fixture(),ev=event('@ultron regress',false,913);
  m.add(ev);
  const result=await m.invoke(ev);
  assert.equal(result.intent,'regress');
  assert.ok(m.state.posts.some(x=>x.path.endsWith('/dispatches')));
  assert.match(m.state.comments.at(-1).body,/No green regression claim/);
});

test('credentials status provides policy, never literal owner keys',async()=>{
  const m=fixture(),ev=event('@ultron credentials',false,914);
  m.add(ev);
  const result=await m.invoke(ev);
  assert.equal(result.intent,'credentials');
  assert.match(m.state.comments.at(-1).body,/owner-authorized grants/);
  assert.match(m.state.comments.at(-1).body,/short-lived workflow credential/);
  assert.doesNotMatch(m.state.comments.at(-1).body,/ghp_[a-zA-Z0-9]+/);
});
