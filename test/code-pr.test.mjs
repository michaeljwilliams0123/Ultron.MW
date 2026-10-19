import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCodePrRequest,launchCodePr,CODE_PR_MARKER,CODE_PR_TITLE } from '../src/code-pr.mjs';
import { createCloudPrUrl } from '../docs/core/cloud-pr-submit.mjs';
import { readFile } from 'node:fs/promises';

const REPO='michaeljwilliams0123/Ultron.MW', OWNER='michaeljwilliams0123';
const ROOT='/repos/'+REPO;
const BASE='a'.repeat(40), BLOBS=['b'.repeat(40),'c'.repeat(40)];
const TREE='d'.repeat(40), COMMIT='e'.repeat(40);
function envelope(changes=[{path:'src/brain.mjs',before:'old value',after:'new value'}]){
  return {objective:'Improve routing implementation',baseSha:BASE,changes};
}
function issue(n=901,manifest=envelope()){
  return {action:'opened',issue:{number:n,title:CODE_PR_TITLE,state:'open',
    user:{login:OWNER},body:CODE_PR_MARKER+'\n'+JSON.stringify(manifest)}};
}
function backend(evt=issue()){
  const state={main:BASE,branch:null,pr:null,comment:null,files:new Map([['src/brain.mjs','prefix old value suffix']]),blobs:[],calls:[]};
  const branch='ultron/code-issue-'+evt.issue.number;
  const get=async path=>{
    state.calls.push('GET '+path);
    if(path===ROOT+'/issues/'+evt.issue.number)return evt.issue;
    if(path===ROOT+'/git/ref/heads/main')return {object:{sha:state.main}};
    if(path===ROOT+'/git/ref/heads/'+branch)return {object:{sha:state.branch}};
    if(path===ROOT+'/git/commits/'+BASE)return {tree:{sha:BASE}};
    if(path.startsWith(ROOT+'/pulls?'))return state.pr?[state.pr]:[];
    if(state.pr&&path===ROOT+'/pulls/'+state.pr.number)return state.pr;
    if(state.comment&&path===ROOT+'/issues/comments/'+state.comment.id)return state.comment;
    const match=path.match(/^\/repos\/michaeljwilliams0123\/Ultron\.MW\/contents\/(.+)\?ref=(.+)$/);
    if(match){
      const pathName=match[1],ref=decodeURIComponent(match[2]);
      const found=state.files.get(pathName);
      if(found===undefined)throw Error('missing file');
      const output=ref===BASE?found:(state.changed?.get(pathName)??found);
      return {encoding:'base64',content:Buffer.from(output).toString('base64')};
    }
    throw Error('Unexpected request '+path);
  };
  const getOptional=async path=>{
    if(path===ROOT+'/git/ref/heads/'+branch&&!state.branch)return null;
    if(path.includes('/contents/')) {
      const filePath=path.split('/contents/')[1].split('?')[0];
      if(!state.files.has(filePath))return null;
    }
    return get(path);
  };
  const post=async(path,body)=>{
    state.calls.push('POST '+path);
    if(path===ROOT+'/git/blobs'){
      assert.equal(body.encoding,'utf-8');
      const sha=BLOBS[state.blobs.length]||'f'.repeat(40);
      state.blobs.push({...body,sha});return {sha};
    }
    if(path===ROOT+'/git/trees'){
      assert.equal(body.base_tree,BASE);
      assert.equal(body.tree.length,state.blobs.length);
      state.changed=new Map(state.blobs.map((x,i)=>[body.tree[i].path,x.content]));
      return {sha:TREE};
    }
    if(path===ROOT+'/git/commits'){
      assert.deepEqual(body.parents,[BASE]); assert.equal(body.tree,TREE);
      return {sha:COMMIT};
    }
    if(path===ROOT+'/git/refs'){
      assert.equal(body.ref,'refs/heads/'+branch);
      assert.equal(body.sha,COMMIT);
      state.branch=COMMIT;return {object:{sha:COMMIT}};
    }
    if(path===ROOT+'/pulls'){
      assert.equal(body.base,'main');assert.equal(body.head,branch);
      assert.equal(body.draft,false);
      state.pr={number:32,html_url:'https://github.com/'+REPO+'/pull/32',
        body:body.body,head:{ref:branch,sha:COMMIT,repo:{full_name:REPO}},
        base:{ref:'main',repo:{full_name:REPO}}};
      return state.pr;
    }
    if(path===ROOT+'/actions/workflows/verify.yml/dispatches'){
      assert.equal(body.ref,branch);return {};
    }
    if(path===ROOT+'/issues/'+evt.issue.number+'/comments'){
      state.comment={id:55,body:body.body,user:{login:'github-actions[bot]'}};
      return {id:55};
    }
    throw Error('Unexpected post '+path);
  };
  return {get,getOptional,post,state};
}
function args(evt,db){
  return {event:evt,repository:REPO,actor:OWNER,executorSha:BASE,
    get:db.get,getOptional:db.getOptional,post:db.post};
}
test('same Pages PR action supports owner-confirmed source code routing',()=>{
  const manifest=envelope();
  const u=new URL(createCloudPrUrl(JSON.stringify(manifest)));
  assert.equal(u.searchParams.get('title'),CODE_PR_TITLE);
  assert.equal(u.searchParams.get('body'),CODE_PR_MARKER+'\n'+JSON.stringify(manifest));
  assert.equal(u.searchParams.has('token'),false);
});
test('one atomic source commit creates a non-draft code PR into main',async()=>{
  const evt=issue(),db=backend(evt);
  const result=await launchCodePr(args(evt,db));
  assert.equal(result.status,'created');
  assert.equal(result.number,32);
  assert.equal(result.base,'main');
  assert.deepEqual(result.files,['src/brain.mjs']);
  assert.equal(db.state.blobs[0].content,'prefix new value suffix');
  assert.equal(db.state.branch,COMMIT);
  assert.match(db.state.comment.body,/Code PR targeting main/);
  assert.equal(db.state.calls.filter(x=>x==='POST '+ROOT+'/pulls').length,1);
  assert.equal(db.state.calls.filter(x=>x.endsWith('/dispatches')).length,1);
});
test('same request cannot commit or publish twice',async()=>{
  const evt=issue(),db=backend(evt);
  await launchCodePr(args(evt,db));
  const n=db.state.calls.length;
  const repeat=await launchCodePr(args(evt,db));
  assert.equal(repeat.status,'already-created');
  assert.equal(db.state.calls.slice(n).filter(x=>x.startsWith('POST ')).length,0);
});
test('wrong identity, invalid source paths and ambiguous patches are rejected',async()=>{
  for(const changes of [
    [{path:'.github/workflows/verify.yml',create:'unsafe'}],
    [{path:'src/../secrets.mjs',create:'unsafe'}],
    [{path:'src/brain.mjs',before:'old value',after:'yes'},
     {path:'src/brain.mjs',before:'old value',after:'duplicate'}]
  ]){
    assert.throws(()=>parseCodePrRequest(issue(2,envelope(changes)),OWNER,REPO),/path/);
  }
  const evt=issue(),db=backend(evt);
  await assert.rejects(()=>launchCodePr({...args(evt,db),actor:'other'}),/owner-created/);
  assert.equal(db.state.calls.length,0);
  const ambiguous=issue(92,envelope([{path:'src/brain.mjs',before:'x',after:'y'}]));
  const mock=backend(ambiguous);
  await assert.rejects(()=>launchCodePr(args(ambiguous,mock)),/context missing or ambiguous/);
  assert.equal(mock.state.calls.some(x=>x.startsWith('POST ')),false);
});
test('stale exact main blocks all writes',async()=>{
  const evt=issue(),db=backend(evt);
  db.state.main='9'.repeat(40);
  await assert.rejects(()=>launchCodePr(args(evt,db)),/Exact-main/);
  assert.equal(db.state.calls.filter(x=>x.startsWith('POST ')).length,0);
});
test('source PR route retains verified GitHub owner and read-only CI isolation',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/cloud-pr.yml',import.meta.url),'utf8');
  const verify=await readFile(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
  assert.match(workflow,/ULTRON_CODE_PR_V1/);
  assert.match(workflow,/github.actor == 'michaeljwilliams0123'/);
  assert.match(workflow,/run: node src\/cloud-pr\.mjs/);
  assert.match(verify,/contents: read/);
  assert.doesNotMatch(verify,/pull-requests: write/);
});
