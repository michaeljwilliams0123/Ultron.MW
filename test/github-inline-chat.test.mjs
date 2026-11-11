import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInlineChat,admitInlineChat,runInlineChat} from '../src/github-inline-chat.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const ALT='michaeljwilliams0123ultron';
const ROOT='/repos/'+REPO;
const command='@ultron chat What does this PR change?';
function event(body=command,actor=OWNER,id=999){
  return {action:'created',comment:{id,user:{login:actor},body},
    issue:{number:387,state:'open',pull_request:{url:'https://api.github.com/repos/'+REPO+'/pulls/387'}}};
}
function fixture(actor=OWNER){
  const e=event(command,actor),state={comments:[structuredClone(e.comment)],posts:[],modelCalls:0};
  const get=async path=>{
    if(path===ROOT+'/pulls/387')return {number:387,state:'open',base:{ref:'main',repo:{full_name:REPO,private:false}}};
    if(path.startsWith(ROOT+'/issues/387/comments?'))return state.comments;
    if(path.startsWith(ROOT+'/issues/comments/'))return state.comments.find(c=>c.id===Number(path.split('/').at(-1)));
    throw Error('unexpected read '+path);
  };
  const post=async(path,body)=>{
    assert.equal(path,ROOT+'/issues/387/comments');
    state.posts.push(body);
    const c={id:1001,body:body.body,user:{login:'github-actions[bot]'}};
    state.comments.push(c);return {id:c.id};
  };
  const infer=async messages=>{state.modelCalls++;
    assert.equal(messages.length,2);
    assert.equal(messages[0].role,'system');
    assert.match(messages[0].content,/NOT Destiny/);
    assert.match(messages[1].content,/What does this PR change/);
    return 'The diff must be inspected before making a claim.';};
  const run=(override={})=>runInlineChat({event:e,actor,repository:REPO,eventName:'issue_comment',get,post,infer,
    env:{ULTRON_PUBLIC_CPU_INFERENCE:'enabled'},...override});
  return {e,state,get,post,infer,run};
}

test('only explicit chat command is parsed, and no ordinary GitHub tag is Codex or inline chat',()=>{
  assert.equal(parseInlineChat(command),'What does this PR change?');
  for(const value of ['@michaeljwilliams0123ultron','@destiny-codex',
    '@codex review','/codex run destiny-codex','@ultron chat ',
    '@ultron chat a', '@ultron chat '+ 'x'.repeat(901),
    'Please @ultron chat how?', '@ultron chat hello\nmore'])
    assert.equal(parseInlineChat(value),null,value);
});

test('only owner or designated secondary account can invoke public-CPU inline path',()=>{
  for(const actor of [OWNER,ALT])assert.equal(admitInlineChat({event:event(command,actor),actor,repository:REPO,eventName:'issue_comment'}).actor,actor);
  for(const actor of ['attacker','github-actions[bot]','chatgpt-codex-connector[bot]'])
    assert.equal(admitInlineChat({event:event(command,actor),actor,repository:REPO,eventName:'issue_comment'}),null);
  assert.equal(admitInlineChat({event:event(),actor:ALT,repository:REPO,eventName:'issue_comment'}),null);
  assert.equal(admitInlineChat({event:event(),actor:OWNER,repository:'fork/repo',eventName:'issue_comment'}),null);
  assert.equal(admitInlineChat({event:{...event(),issue:{number:387,state:'open'}},actor:OWNER,repository:REPO,eventName:'issue_comment'}),null);
});

test('authorized inline chat replies with correct bot identity and readback',async()=>{
  const f=fixture(ALT);const result=await f.run();
  assert.equal(result.status,'replied');assert.equal(result.provider,'local-cpu-only');
  assert.equal(f.state.modelCalls,1);
  assert.match(f.state.posts[0].body,/comment:999 -->/);
  assert.match(f.state.posts[0].body,/github-actions\[bot\]/);
  assert.match(f.state.posts[0].body,/Not Destiny’s ChatGPT conversation/);
  const again=await f.run();assert.equal(again.status,'already-replied');
  assert.equal(f.state.modelCalls,1);assert.equal(f.state.posts.length,1);
});

test('disabled inference never calls provider and gives no-paid fallback',async()=>{
  const f=fixture();const result=await f.run({env:{ULTRON_PUBLIC_CPU_INFERENCE:'disabled'},
    infer:()=>{throw Error('must never call');}});
  assert.equal(result.status,'replied');
  assert.match(f.state.posts[0].body,/No paid fallback or Codex call/);
});

test('CPU inference failure produces honest bounded fallback without using paid providers',async()=>{
  const f=fixture();await f.run({infer:async()=>{throw Error('no weights');}});
  assert.match(f.state.posts[0].body,/public CPU model was unavailable/);
  assert.equal(f.state.posts.length,1);
});

test('uninformative CPU refusal yields a truthful lane explanation, never an invented ChatGPT reply',async()=>{
  const f=fixture();
  const result=await f.run({infer:async()=>"I'm sorry, but I can't assist with that request."});
  assert.equal(result.status,'replied');
  assert.match(f.state.posts[0].body,/local CPU model returned a generic refusal/i);
  assert.match(f.state.posts[0].body,/GitHub mention/);
  assert.match(f.state.posts[0].body,/\/codex run/);
  assert.match(f.state.posts[0].body,/not Destiny.*ChatGPT Plus/i);
  assert.equal(f.state.posts.length,1);
});

test('unverified event and spoofed comment never publish',async()=>{
  const f=fixture();f.state.comments[0].body='changed after trigger';
  await assert.rejects(f.run(),/Originating GitHub actor/);
  assert.equal(f.state.posts.length,0);
});

test('wrong PR base never causes infer or issue comment write',async()=>{
  const f=fixture();const r=await f.run({get:async()=>({number:387,state:'open',base:{ref:'release',repo:{full_name:REPO}}})});
  assert.equal(r.status,'ignored-invalid-pr');assert.equal(f.state.posts.length,0);
});

test('reply verification requires actual GitHub bot echo',async()=>{
  const f=fixture();await assert.rejects(f.run({get:async path=>{
    const reply=await f.get(path);
    return path.startsWith(ROOT+'/issues/comments/')?{...reply,user:{login:'attacker'}}:reply;
  }}),/readback failed/);
});

test('workflow is opt-in, non-paid, and limits permissions',async()=>{
  const {readFile}=await import('node:fs/promises');
  const yaml=await readFile(new URL('../.github/workflows/inline-pr-chat.yml',import.meta.url),'utf8');
  assert.match(yaml,/startsWith\(github\.event\.comment\.body, '@ultron chat '\)/);
  assert.match(yaml,/github\.event\.repository\.private == false/);
  assert.match(yaml,/github\.actor == 'michaeljwilliams0123ultron'/);
  // GitHub PR timeline comments need both scopes on affected Actions tokens;
  // PR #387 live canary returned HTTP 403 with Issues:write only.
  assert.match(yaml,/permissions:\n\s+contents: read\n\s+issues: write\n\s+pull-requests: write/);
  assert.doesNotMatch(yaml,/OPENAI_API_KEY|contents: write|@codex/);
});
