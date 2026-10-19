import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrRequest, proposalContent, launchCloudPr,
  PR_OWNER, PR_REPOSITORY, PR_ISSUE_TITLE, PR_MARKER } from '../src/cloud-pr.mjs';
import { createCloudPrUrl } from '../docs/core/cloud-pr-submit.mjs';
import { readFile } from 'node:fs/promises';

const BASE = 'a'.repeat(40), NEW = 'b'.repeat(40);
const ROOT = '/repos/' + PR_REPOSITORY;
function event(number=51, objective='Add better cloud routing') {
  return {
    action:'opened',
    issue:{number, title:PR_ISSUE_TITLE, state:'open',
      body:PR_MARKER + '\n' + objective, user:{login:PR_OWNER}},
  };
}
function mockGitHub(evt=event(), main=BASE) {
  let currentMain=main, branchSha=null, fileText=null, pr=null, note=null;
  const calls=[], info={...evt.issue,user:{...evt.issue.user}};
  const fail=()=>{throw Error('Unexpected API call')};
  const get=async path=>{
    calls.push('GET '+path);
    if(path===ROOT+'/issues/'+info.number)return info;
    if(path===ROOT+'/git/ref/heads/main')return {object:{sha:currentMain}};
    if(path===ROOT+'/git/ref/heads/ultron/issue-'+info.number)
      return branchSha?{object:{sha:branchSha}}:fail();
    if(path.startsWith(ROOT+'/pulls?'))return pr?[pr]:[];
    if(pr && path===ROOT+'/pulls/'+pr.number)return pr;
    if(path.startsWith(ROOT+'/contents/docs/proposals/issue-'+info.number+'.md?ref='))
      return fileText?{encoding:'base64',content:Buffer.from(fileText).toString('base64')}:fail();
    if(note && path===ROOT+'/issues/comments/'+note.id)return note;
    return fail();
  };
  const getOptional=async path=>{
    if(path===ROOT+'/git/ref/heads/ultron/issue-'+info.number&&!branchSha)return null;
    if(path.startsWith(ROOT+'/contents/docs/proposals/issue-'+info.number+'.md?ref=')&&!fileText)return null;
    return get(path);
  };
  const post=async(path,body)=>{
    calls.push('POST '+path);
    if(path===ROOT+'/git/refs'){
      assert.equal(body.sha,currentMain);
      assert.equal(body.ref,'refs/heads/ultron/issue-'+info.number);
      branchSha=body.sha;
      return {ref:body.ref};
    }
    if(path===ROOT+'/pulls'){
      assert.equal(body.base,'main');
      assert.equal(body.draft,false);
      assert.equal(body.head,'ultron/issue-'+info.number);
      assert.ok(fileText.includes('Request digest: '));
      pr={number:88,html_url:'https://github.com/'+PR_REPOSITORY+'/pull/88',
        title:body.title,body:body.body,head:{ref:body.head,sha:branchSha,repo:{full_name:PR_REPOSITORY}},
        base:{ref:body.base,repo:{full_name:PR_REPOSITORY}}};
      return pr;
    }
    if(path===ROOT+'/actions/workflows/verify.yml/dispatches'){
      assert.equal(body.ref,'ultron/issue-'+info.number);
      return {};
    }
    if(path===ROOT+'/issues/'+info.number+'/comments'){
      note={id:101,body:body.body,user:{login:'github-actions[bot]'}};
      return {id:101};
    }
    return fail();
  };
  const put=async(path,body)=>{
    calls.push('PUT '+path);
    assert.equal(path,ROOT+'/contents/docs/proposals/issue-'+info.number+'.md');
    assert.equal(body.branch,'ultron/issue-'+info.number);
    assert.equal(branchSha,currentMain);
    fileText=Buffer.from(body.content,'base64').toString('utf8');
    branchSha=NEW;
    return {content:{path},commit:{sha:NEW}};
  };
  return {
    event:evt, get,getOptional,post,put,calls,
    setMain:v=>{currentMain=v;},
    setIssue:v=>Object.assign(info,v),
    setBranch:v=>{branchSha=v;},
    get state(){return {branchSha,fileText,pr,note,currentMain};},
  };
}
function params(mock,executorSha=BASE){
  return {event:mock.event, actor:PR_OWNER,repository:PR_REPOSITORY,
    executorSha,get:mock.get,getOptional:mock.getOptional,post:mock.post,put:mock.put};
}
test('Pages PR action requires GitHub owner confirmation and no token',()=>{
  const url=new URL(createCloudPrUrl('Implement cloud PR creation'));
  assert.equal(url.hostname,'github.com');
  assert.equal(url.searchParams.get('title'),PR_ISSUE_TITLE);
  assert.equal(url.searchParams.get('body'),PR_MARKER+'\nImplement cloud PR creation');
  assert.equal(url.searchParams.has('token'),false);
  assert.throws(()=>createCloudPrUrl('anything\nsecond line'),/one public PR objective/);
  assert.throws(()=>createCloudPrUrl(''),/one public PR objective/);
  assert.throws(()=>createCloudPrUrl('a'.repeat(1001)),/one public PR objective/);
});

test('owner-created issue routes to exact immutable branch proposal and PR to main',async()=>{
  const mock=mockGitHub();
  const result=await launchCloudPr(params(mock));
  assert.equal(result.status,'created');
  assert.equal(result.prNumber,88);
  assert.equal(result.base,'main');
  assert.equal(result.contentVerified,true);
  assert.equal(result.verificationDispatched,true);
  assert.equal(mock.state.currentMain,BASE);
  assert.equal(mock.state.branchSha,NEW);
  assert.match(mock.state.fileText,/Requested capability/);
  assert.match(mock.state.fileText,/Add better cloud routing/);
  assert.match(mock.state.fileText,/No source-code behavior changes are asserted/);
  assert.match(mock.state.note.body,/PR created targeting main/);
  assert.match(mock.state.note.body,/github\.com\/michaeljwilliams0123\/Ultron\.MW\/pull\/88/);
  assert.deepEqual(mock.calls.filter(x=>x.startsWith('PUT ')),
    [ 'PUT '+ROOT+'/contents/docs/proposals/issue-51.md' ]);
  assert.equal(mock.calls.filter(x=>x.startsWith('POST '+ROOT+'/pulls')).length,1);
  assert.equal(mock.calls.filter(x=>x.includes('/dispatches')).length,1);
  assert.equal(mock.calls.filter(x=>x.includes('/issues/51/comments')).length,1);
});

test('repeated owner issue is idempotent and never writes a second proposal',async()=>{
  const mock=mockGitHub();
  await launchCloudPr(params(mock));
  const before=mock.calls.length;
  const result=await launchCloudPr(params(mock));
  assert.equal(result.status,'already-created');
  assert.equal(result.prNumber,88);
  assert.equal(result.contentVerified,true);
  assert.ok(mock.calls.slice(before).every(x=>x.startsWith('GET ')));
});

test('unauthorized, malformed or edited public issue is rejected before a write',async()=>{
  for(const invalid of [
    {actor:'outsider'},
    {repository:'someone/other'},
    {issue:{...event().issue,user:{login:'outsider'}}},
    {issue:{...event().issue,title:'[Ultron Cloud] Objective'}},
    {issue:{...event().issue,state:'closed'}},
    {issue:{...event().issue,body:PR_MARKER+'\nBad\nsecond line'}},
    {issue:{...event().issue,pull_request:{url:'spoof'}}},
  ]){
    const evt={...event(),...(invalid.issue?{issue:invalid.issue}:{})};
    const mock=mockGitHub(evt);
    await assert.rejects(()=>launchCloudPr({
      ...params(mock),actor:invalid.actor??PR_OWNER,
      repository:invalid.repository??PR_REPOSITORY,
    }),/PR request|one line/);
    assert.equal(mock.calls.filter(x=>x.startsWith('POST ')||x.startsWith('PUT ')).length,0);
  }
  const changed=mockGitHub();
  changed.setIssue({body:PR_MARKER+'\nModified after opening'});
  await assert.rejects(()=>launchCloudPr(params(changed)),/owner|PR request|changed/);
});

test('stale main and unrelated existing PR branch fail before source mutation',async()=>{
  const mismatch=mockGitHub();
  mismatch.setMain(NEW);
  await assert.rejects(()=>launchCloudPr(params(mismatch)),/not current main/);
  assert.equal(mismatch.calls.filter(x=>x.startsWith('POST ')).length,0);
  const hijack=mockGitHub();
  hijack.setBranch(NEW);
  await assert.rejects(()=>launchCloudPr(params(hijack)),/unrelated changes/);
  assert.equal(hijack.calls.filter(x=>x.startsWith('POST ')).length,0);
});

test('no browser token or automatic merge route is exposed by workflow',async()=>{
  const script=await readFile(new URL('../.github/workflows/cloud-pr.yml',import.meta.url),'utf8');
  const verify=await readFile(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
  const html=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../docs/app.js',import.meta.url),'utf8');
  assert.match(script,/github\.actor == 'michaeljwilliams0123'/);
  assert.match(script,/pull-requests: write/);
  assert.match(script,/contents: write/);
  assert.match(script,/persist-credentials: false/);
  assert.match(script,/run: node src\/cloud-pr\.mjs/);
  assert.doesNotMatch(script,/issue\.body\s*\}\}/);
  assert.match(verify,/workflow_dispatch:/);
  assert.match(html,/id="cloud-pr"/);
  assert.match(app,/createCloudPrUrl/);
  assert.doesNotMatch(app,/GITHUB_TOKEN/);
});
