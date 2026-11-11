import test from 'node:test';
import assert from 'node:assert/strict';
import { answerVerifiedInlineQuestion, isUsefulInlineAnswer, runInlineChat } from '../src/github-inline-chat.mjs';

const REPO='michaeljwilliams0123/Ultron.MW';
const ROOT='/repos/'+REPO;
const ROUTING='Summarize how GitHub mentions differ from deliberate Codex tasks, and state your actual identity and limits.';
const PR={number:387,state:'open',title:'Observation only: owner mention to secondary Ultron GitHub account',
  changed_files:2,head:{sha:'a'.repeat(40)},base:{ref:'main',repo:{full_name:REPO,private:false}}};
const files=[
  {filename:'docs/experiments/owner-mention.md',status:'added'},
  {filename:'test/mention.test.mjs',status:'modified'},
];

function fixture(question=ROUTING,modelOutput='This is a substantive answer about release notes.') {
  const event={action:'created',comment:{id:999,user:{login:'michaeljwilliams0123'},
    body:'@ultron chat '+question},issue:{number:387,state:'open',
    pull_request:{url:'https://api.github.com/repos/'+REPO+'/pulls/387'}}};
  const state={calls:[],posts:[],modelCalls:0,comments:[structuredClone(event.comment)]};
  const get=async path=>{
    state.calls.push(path);
    if(path===ROOT+'/pulls/387')return structuredClone(PR);
    if(path===ROOT+'/pulls/387/files?per_page=100&page=1')return structuredClone(files);
    if(path.startsWith(ROOT+'/issues/387/comments?'))return state.comments;
    if(path.startsWith(ROOT+'/issues/comments/'))return state.comments.find(c=>c.id===Number(path.split('/').at(-1)));
    throw Error('unmocked GET '+path);
  };
  const post=async(path,body)=>{
    assert.equal(path,ROOT+'/issues/387/comments');
    state.posts.push(body.body);
    const c={id:1001,user:{login:'github-actions[bot]'},body:body.body};
    state.comments.push(c);return {id:c.id};
  };
  const infer=async()=>{state.modelCalls++;return modelOutput;};
  const run=()=>runInlineChat({event,actor:'michaeljwilliams0123',repository:REPO,
    eventName:'issue_comment',get,post,infer,env:{ULTRON_PUBLIC_CPU_INFERENCE:'enabled'}});
  return {get,state,run};
}

test('exact harmless live question is answered from verified routing policy without invoking a CPU model', async()=>{
  const f=fixture();
  const result=await f.run();
  assert.equal(result.status,'replied');
  assert.equal(f.state.modelCalls,0);
  assert.match(f.state.posts[0],/@michaeljwilliams0123ultron/);
  assert.match(f.state.posts[0],/\/codex run destiny-codex/);
  assert.match(f.state.posts[0],/github-actions\[bot\]/);
  assert.doesNotMatch(f.state.posts[0],/I'm sorry, but I can't assist/i);
});

test('routing variants are grounded, with no claims of ChatGPT Plus or external Codex authentication',async()=>{
  for (const question of [
    'Explain the difference between a GitHub mention and an explicit Codex task. Do not claim access to ChatGPT Plus.',
    'What is the difference between GitHub mentions and Codex task execution?',
  ]) {
    const a=await answerVerifiedInlineQuestion({question,pr:PR,number:387});
    assert.equal(a.basis,'github-policy');
    assert.match(a.answer,/notification/i);
    assert.match(a.answer,/provenance/i);
    assert.match(a.answer,/not an authenticated ChatGPT/i);
  }
});

test('self identity asks identify the bot, not the collaborator or an authenticated ChatGPT account',async()=>{
  const a=await answerVerifiedInlineQuestion({question:'Who are you and what can you do?',pr:PR,number:387});
  assert.equal(a.basis,'github-policy');
  assert.match(a.answer,/github-actions\[bot\]/);
  assert.match(a.answer,/read-only/i);
  assert.match(a.answer,/not.*ChatGPT Plus/i);
});

test('PR changed-file answer derives from same-PR GitHub readback, not guessed semantics',async()=>{
  const f=fixture('What does this PR change?');
  const result=await f.run();
  assert.equal(result.status,'replied');
  assert.equal(f.state.modelCalls,0);
  assert.match(f.state.posts[0],/docs\/experiments\/owner-mention\.md/);
  assert.match(f.state.posts[0],/test\/mention\.test\.mjs/);
  assert.match(f.state.posts[0],/2 files/);
  assert.match(f.state.posts[0],/file inventory/i);
  assert.ok(f.state.calls.includes(ROOT+'/pulls/387/files?per_page=100&page=1'));
});

test('partial PR file inventory fails closed instead of presenting incomplete evidence as complete',async()=>{
  const a=await answerVerifiedInlineQuestion({question:'What does this PR change?',
    pr:{...PR,changed_files:101},number:387,get:async()=>files});
  assert.equal(a.basis,'github-unavailable');
  assert.doesNotMatch(a.answer,/Verified changed files/i);
  assert.match(a.answer,/Files changed/);
});

test('generic refusals and echoes cannot pass useful answer quality gate',()=>{
  for (const answer of [
    "I'm sorry, but I can't assist with that request.",
    "I cannot help with that question.",
    "As an AI language model, I can't assist.",
    "  ",
    'Summarize how GitHub mentions differ from deliberate Codex tasks, and state your actual identity and limits.',
  ]) assert.equal(isUsefulInlineAnswer(answer,ROUTING),false,answer);
  assert.equal(isUsefulInlineAnswer('A GitHub mention notifies a collaborator, whereas explicit commands are auditable.'),true);
});

test('model refusal is replaced with truthful, useful quality fallback; duplicate event stays idempotent',async()=>{
  const f=fixture('Tell me about effective documentation practices',"I'm sorry, but I can't assist with that request.");
  const a=await f.run();
  assert.equal(a.status,'replied');
  assert.equal(f.state.modelCalls,1);
  assert.doesNotMatch(f.state.posts[0],/I'm sorry, but I can't assist/i);
  assert.match(f.state.posts[0],/did not produce a useful answer/i);
  assert.match(f.state.posts[0],/@ultron chat/i);
  assert.equal((await f.run()).status,'already-replied');
  assert.equal(f.state.posts.length,1);
});

test('unknown questions remain free local CPU only with no paid key or writes beyond PR comments',async()=>{
  const f=fixture('Suggest three ways to improve our release notes.');
  const a=await f.run();
  assert.equal(a.status,'replied');
  assert.equal(f.state.modelCalls,1);
  assert.match(f.state.posts[0],/substantive answer about release notes/);
  assert.equal(f.state.posts.length,1);
});
