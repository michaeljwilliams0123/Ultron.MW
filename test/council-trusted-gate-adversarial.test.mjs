import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  classifyTrustedRisk,gatePasses,buildGateCheckRun,
  selectCouncilTargetNumber,resolveGatePublisher,ownerIntent,isOwnerAccount,
} from '../src/council-trusted-gate.mjs';

const SHA='a'.repeat(40),BASE='b'.repeat(40),PR=454;
const OWNER={id:308995719,login:'michaeljwilliams0123',type:'User'};
const OTHER={id:354634860,login:'michaeljwilliams0123ultron',type:'User'};

test('mixed malformed changed-file entries fail closed instead of clearing a security hold',()=>{
  const cases=[
    [{filename:'docs/notes.md'},{filename:null}],
    [{filename:'src/widget.mjs'},{}],
    [{filename:'docs/readme.md'},null],
    [{filename:'docs/readme.md'},{filename:42}],
    [{filename:'docs/readme.md'},{previous_filename:'config/keys.json',filename:null}],
  ];
  for(const files of cases){
    const result=classifyTrustedRisk({files,filesComplete:true});
    assert.equal(result.security,true,JSON.stringify(files));
    assert.equal(result.complete,false,JSON.stringify(files));
  }
});

test('forged override flags lacking a trusted gate schema cannot publish a green check',()=>{
  const minimal={sourceSha:SHA,baseSha:BASE,prNumber:PR,
    status:'owner-overridden',overrideUsed:true,overrideSignatureVerified:true,
    securitySensitive:true,approvedCount:0};
  assert.equal(gatePasses(minimal,SHA,PR),false);
  assert.equal(buildGateCheckRun(minimal,{sha:SHA,prNumber:PR}).conclusion,'failure');
  for(let approvals=0;approvals<7;approvals++){
    assert.equal(gatePasses({...minimal,approvedCount:approvals},SHA,PR),false, String(approvals));
  }
});

test('manual target selector denies noncanonical unicode, number coercion and overflow',()=>{
  const invalid=[undefined,null,'',false,true,NaN,Infinity,-Infinity,-1,0,0.1,1.5,
    ' 454','454 ','+454','0454','4.54','1e3','0x10','0b10','1_000',
    '٠١٢','４５４','4\n54','4\u000054','9007199254740992',{},[],['454']];
  for(const raw of invalid){
    const received=selectCouncilTargetNumber('workflow_dispatch',{inputs:{pr_number:raw}});
    assert.equal(received,null,JSON.stringify(raw));
  }
  for(const n of [1,2,454,2147483647,Number.MAX_SAFE_INTEGER]){
    assert.equal(selectCouncilTargetNumber('workflow_dispatch',{inputs:{pr_number:String(n)}}),n);
  }
  for(const event of ['workflow_run','pull_request','issues','issue_comment_created','push','schedule',null,'']){
    const payload={inputs:{pr_number:'454'},issue:{number:454},pull_request:{number:454}};
    assert.equal(selectCouncilTargetNumber(event,payload),null,String(event));
  }
});

test('owner identity and stale review matrix never delegates exact-head approval to bot',()=>{
  const p={user:OTHER,head:{sha:SHA}};
  for(const review of [
    {user:OWNER,state:'APPROVED',commit_id:BASE},
    {user:OWNER,state:'CHANGES_REQUESTED',commit_id:SHA},
    {user:OTHER,state:'APPROVED',commit_id:SHA},
    {user:{...OWNER,type:'Bot'},state:'APPROVED',commit_id:SHA},
  ])assert.equal(ownerIntent(p,[review]).owner,false,JSON.stringify(review));
  assert.equal(ownerIntent(p,[{user:OWNER,state:'APPROVED',commit_id:SHA}]).owner,true);
  assert.equal(isOwnerAccount({...OWNER,id:String(OWNER.id)}),false);
});

test('publisher cannot be impersonated by a generic Actions token or malformed identity',()=>{
  const valid={appId:'123456',expectedSlug:'ultron-council-gate',mintedSlug:'ultron-council-gate'};
  assert.equal(resolveGatePublisher(valid).slug,'ultron-council-gate');
  for(const change of [{appId:'0'},{appId:'01'},{appId:'github-actions'},
    {appId:''},{expectedSlug:'github-actions'},{mintedSlug:'github-actions'},
    {mintedSlug:''},{expectedSlug:'ultron-council-gate\n'}]){
    const candidate={...valid,...change};
    // An intentionally mismatched slug may still be a valid app only if both change together.
    assert.equal(resolveGatePublisher(candidate),null,JSON.stringify(change));
  }
});

test('trusted workflow retains dedicated App publication and immutable PR readback',()=>{
  const y=readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
  assert.equal((y.match(/gate\.exactHeadReadState\(/g)||[]).length,3);
  assert.match(y,/Council run superseded before publish; newer exact-head run owns the decision/);
  assert.doesNotMatch(y,/Council PR changed before publish|Council PR head\/base changed during readback/);
  assert.match(y,/permission-checks: write/);
  assert.match(y,/github-token: \$\{\{ steps\.app\.outputs\.token \}\}/);
  assert.match(y,/Fail closed when the Council Gate App is not configured[\s\S]*exit 1/);
  assert.match(y,/github\.actor_id == '308995719'/);
  assert.match(y,/github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(y,/checkout@[^\n]*\n\s+with:\n\s+ref: \$\{\{/);
});

test('gate-check publication rejects missing schema, base SHA, and cross-PR replay',()=>{
  const valid={schema:'ultron.council-trusted-gate.v2',sourceSha:SHA,baseSha:BASE,
    prNumber:PR,status:'accepted',securitySensitive:false,approvedCount:7};
  assert.equal(gatePasses(valid,SHA,PR),true);
  const changes=[
    {schema:undefined},{schema:'untrusted-acceptance-v1'},
    {baseSha:undefined},{baseSha:'bad'},{baseSha:'B'.repeat(40)},
    {sourceSha:BASE},{prNumber:PR+1},{prNumber:'454'},
    {approvedCount:6},{approvedCount:8},{securitySensitive:true},{status:'held'},
  ];
  for(const change of changes){
    const altered={...valid,...change};
    assert.equal(gatePasses(altered,SHA,PR),false,JSON.stringify(change));
    assert.equal(buildGateCheckRun(altered,{sha:SHA,prNumber:PR}).conclusion,'failure');
  }
  assert.equal(gatePasses(valid,BASE,PR),false);
  assert.equal(buildGateCheckRun(valid,{sha:BASE,prNumber:PR}).conclusion,'failure');
});

test('complete valid file-list matrix keeps renames sensitive but ordinary docs non-sensitive',()=>{
  const safe=['docs/x.md','src/component.mjs','test/feature.test.mjs'];
  const sensitive=['.github/workflows/verify.yml','src/security/nonce.mjs',
    'config/council-owner-signing-key.json','package-lock.json'];
  let checks=0;
  for(const current of [...safe,...sensitive])
  for(const previous of [undefined,...safe,...sensitive]){
    const file=previous===undefined?{filename:current}:{filename:current,previous_filename:previous};
    const result=classifyTrustedRisk({files:[file],filesComplete:true});
    assert.equal(result.complete,true,JSON.stringify(file));
    assert.equal(result.security,sensitive.includes(current)||sensitive.includes(previous),JSON.stringify(file));
    checks++;
  }
  assert.equal(checks,56);
});

test('Council dispatch and repo identity cannot be made into a locally hosted or privileged runner',()=>{
  const y=readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8');
  assert.match(y,/runs-on: ubuntu-24[.]04/);
  assert.ok(!y.includes('runs-on: self-hosted')&&!y.includes('127.0.0.1')&&!y.includes('SD009WC7'));
  assert.ok(y.includes('github.event.pull_request.number || github.event.issue.number || inputs.pr_number'));
  assert.match(y,/cancel-in-progress: false/);
  assert.match(y,/github[.]actor == 'michaeljwilliams0123'/);
  assert.match(y,/github[.]actor_id == '308995719'/);
  assert.ok(y.includes("github.ref == 'refs/heads/main'"));
  assert.match(y,/persist-credentials: false/);
});
