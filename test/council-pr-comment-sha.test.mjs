import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const HEAD='a'.repeat(40), BASE='b'.repeat(40);
const yaml=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
const match=yaml.match(/- name: Extract context[^\n]*\n[\s\S]*?\n          script: \|\n([\s\S]*?)\n      - name: Run owner-first council debate/);
assert.ok(match,'trusted Council extraction step exists');
const source=match[1].split('\n').map(line=>line.replace(/^ {12}/,'')).join('\n');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

async function extract({actor='michaeljwilliams0123',comment='/council',state='open',
  fork=false,sha=HEAD,base='main'}={}) {
  const files=new Map(),exports=new Map(),warnings=[];
  let pullsRead=0;
  const repo={id:1424939667,full_name:'michaeljwilliams0123/Ultron.MW'};
  const pr={number:474,state,title:'Fix Council evidence',body:'Exact-head base consistency and release admission regression.',
    changed_files:1,head:{sha,repo:fork?{id:999,full_name:'other/fork'}:repo},
    base:{sha:BASE,ref:base,repo}};
  const github={
    rest:{
      pulls:{get:async()=>{pullsRead++;return {data:pr}},listFiles:async()=>({data:[]})},
      checks:{listForRef:async()=>({data:{total_count:3,check_runs:[]}})},
      repos:{compareCommits:async()=>({data:{status:'ahead',behind_by:0,merge_base_commit:{sha:BASE}}})}
    },
    paginate:async()=>[{filename:'README.md',status:'modified',additions:1,deletions:1,patch:'@@ -1 +1 @@\n-a\n+b'}]
  };
  const context={actor,eventName:'issue_comment',repo:{owner:'michaeljwilliams0123',repo:'Ultron.MW'},
    payload:{issue:{number:474,title:'Fix Council evidence',body:'Original PR body',pull_request:{}},
      comment:{user:{login:actor},body:comment}}};
  const requireMock=(name)=>name==='fs'
    ? {mkdirSync(){},writeFileSync:(path,value)=>files.set(path,value)}
    : name==='path'||name==='node:path' ? {join:(...parts)=>parts.join('/')}
    : name==='node:url' ? {pathToFileURL:()=>({href:'file:///unavailable-test-module.mjs'})}
    : (()=>{throw Error('Unexpected require: '+name)})();
  const core={exportVariable:(name,value)=>exports.set(name,value),
    warning:(msg)=>warnings.push(msg),info(){}};
  const run=new AsyncFunction('require','process','context','github','core',source);
  await run(requireMock,{env:{RUNNER_TEMP:'/tmp',GITHUB_WORKSPACE:'/tmp'}},context,github,core);
  return {files,exports,pullsRead,warnings};
}

test('owner PR slash comment reads live exact HEAD and attaches consistent CI and file evidence',async()=>{
  const out=await extract();
  assert.equal(out.exports.get('IS_PR'),'true');
  assert.equal(out.exports.get('TARGET_SOURCE_SHA'),HEAD);
  const ci=JSON.parse(out.files.get('/tmp/ultron-council/exact-head-ci.json'));
  const files=JSON.parse(out.files.get('/tmp/ultron-council/exact-head-pr-files.json'));
  assert.equal(ci.pr.head.sha,HEAD);
  assert.equal(ci.pr.base.sha,BASE);
  assert.equal(files.sourceSha,HEAD);
  assert.equal(files.baseSha,BASE);
  assert.equal(files.complete,true);
  assert.match(out.files.get('/tmp/ultron-council/body.txt'),/Exact-head base consistency/);
  assert.doesNotMatch(out.files.get('/tmp/ultron-council/body.txt'),/\/council/);
  assert.ok(out.pullsRead>=3);
  assert.equal(out.warnings.some(x=>/CI evidence remains unverified|patch evidence unverified/.test(x)),false);
});

test('owner comment scope blocks spoofed actor, non-command, closed/fork or non-main PR',async()=>{
  for(const inputs of [
    {actor:'untrusted-user'},{comment:'not a council request'},
    {state:'closed'},{fork:true},{base:'other'}, {sha:'invalid'}
  ]) {
    await assert.rejects(()=>extract(inputs),/council-pr-comment-/);
  }
});
