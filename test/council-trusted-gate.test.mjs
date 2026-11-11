import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {evaluateTrustedCouncilGate,classifyTrustedRisk,ownerIntent,isOwnerAccount,
 gatePasses,buildGateCheckRun,resolveGatePublisher,GATE_CHECK_NAME}
 from '../src/council-trusted-gate.mjs';

const HEAD='a'.repeat(40),BASE='b'.repeat(40),PR=456,REPO='michaeljwilliams0123/Ultron.MW';
const NOW='2026-11-10T21:00:00.000Z';
const keyPair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const JWK=keyPair.publicKey.export({format:'jwk'});
const names=['Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'];
const OWNER={login:'michaeljwilliams0123',id:308995719,type:'User'};
const BOT={login:'michaeljwilliams0123ultron',id:354634860,type:'User'};
const repo={id:1424939667,full_name:REPO};
const pr=(user=OWNER)=>({number:PR,state:'open',user,
 head:{sha:HEAD,ref:'feature/x',repo},base:{sha:BASE,ref:'main',repo}});
function evidence(){
 return {report:{itemNumber:PR,isPr:true,sourceSha:HEAD,hold:false,
   memberAssessments:names.map(name=>({identity:{role:name},verdict:'proceed'}))},
  receipt:{decision:'proceed',publication:{members:names.map(n=>({
   roleId:'ultron-'+n.toLowerCase(),conclusion:'proceed',unknowns:[],dissentTags:[],
   evidenceRefs:['case:exact-head']}))},
   modelReview:{results:Object.fromEntries(['Builder','Skeptic','Sentinel'].map(role=>[role,{
    role,source:'model',modelInvoked:true,verdict:'proceed',disagreements:[]}]))}}};
}
const docs=[{filename:'docs/notes.md'}];
const run=(extra={})=>evaluateTrustedCouncilGate({...evidence(),pr:pr(),files:docs,
 filesComplete:true,ownerPublicJwk:JWK,now:NOW,...extra});
function override(lineEnd='\n'){
 const reason='Owner reviewed this security-sensitive change at the exact head.';
 const nonce='c'.repeat(32);
 const msg=['ULTRON-COUNCIL-OVERRIDE-v1',REPO,String(PR),HEAD,BASE,nonce,reason,''].join('\n');
 const sig=sign('sha256',Buffer.from(msg),keyPair.privateKey).toString('base64url');
 return {id:77,user:OWNER,created_at:'2026-11-10T20:50:00Z',updated_at:'2026-11-10T20:50:00Z',
  body:'/council override '+PR+' '+HEAD+' '+BASE+' '+nonce+' -- '+reason+lineEnd+'signature:p256:'+sig};
}

test('7/7 on a non-sensitive change passes and is bound to the exact head',()=>{
 const r=run();
 assert.equal(r.status,'accepted');
 assert.equal(r.securitySensitive,false);
 assert.equal(gatePasses(r,HEAD,PR),true);
 assert.equal(gatePasses(r,'c'.repeat(40),PR),false);
 assert.equal(gatePasses(r,HEAD,PR+1),false);
});
test('security sensitivity comes from changed paths, not PR text (H2)',()=>{
 for(const filename of ['.github/workflows/verify.yml','src/council-release-gate.mjs',
   'src/council-trusted-gate.mjs','scripts/enforce-council-acceptance.mjs',
   'config/council-owner-signing-key.json','src/security/x.mjs','src/capability-auth.mjs',
   'cloud/hatchable/lib/token-store.js','package-lock.json'])
  assert.equal(classifyTrustedRisk({files:[{filename}],filesComplete:true}).security,true,filename);
 assert.equal(classifyTrustedRisk({files:[{filename:'docs/a.md'},{filename:'src/chat-ui.mjs'}],
  filesComplete:true}).security,false);
 // A rename away from a sensitive path still counts.
 assert.equal(classifyTrustedRisk({files:[{filename:'docs/x.yml',
  previous_filename:'.github/workflows/x.yml'}],filesComplete:true}).security,true);
 // Incomplete or missing lists fail closed as sensitive.
 for(const bad of [{files:docs,filesComplete:false},{files:[],filesComplete:true},
   {files:null,filesComplete:true},{files:[{}],filesComplete:true}])
  assert.equal(classifyTrustedRisk(bad).security,true);
});
test('7/7 and green CI never lift a security hold; only a signed owner exception does (H1)',()=>{
 const files=[{filename:'.github/workflows/council-debate.yml'}];
 const r=run({files});
 assert.equal(r.status,'held');
 assert.equal(r.reason,'security-sensitive-change-requires-signed-owner-exception');
 assert.equal(r.approvedCount,7);
 assert.equal(gatePasses(r,HEAD,PR),false);
 const o=run({files,overrideComment:override()});
 assert.equal(o.status,'owner-overridden');
 assert.equal(o.overrideSignatureVerified,true);
 assert.equal(gatePasses(o,HEAD,PR),true);
 // CRLF from some clients still verifies (M4).
 assert.equal(run({files,overrideComment:override('\r\n')}).status,'owner-overridden');
});
test('without a pinned owner key the exception is unavailable (H3, fail-closed)',()=>{
 const files=[{filename:'.github/workflows/council-debate.yml'}];
 assert.equal(run({files,overrideComment:override(),ownerPublicJwk:null}).status,'held');
 const pinned=JSON.parse(readFileSync(new URL('../config/council-owner-signing-key.json',import.meta.url),'utf8'));
 assert.equal(pinned.ownerId,308995719);
 assert.ok(pinned.publicJwk===null||(pinned.publicJwk.kty==='EC'&&pinned.publicJwk.d===undefined));
});
test('a bot-signed or bot-posted override is never the owner',()=>{
 const files=[{filename:'.github/workflows/council-debate.yml'}];
 const c=override();c.user=BOT;
 assert.equal(run({files,overrideComment:c}).status,'held');
});
test('owner intent is Michael only: authored PR or exact-head APPROVED review, never a bot',()=>{
 assert.deepEqual(ownerIntent(pr(OWNER)),{owner:true,via:'owner-authored'});
 assert.deepEqual(ownerIntent(pr(BOT)),{owner:false,via:null});
 assert.deepEqual(ownerIntent(pr(BOT),[{user:BOT,state:'APPROVED',commit_id:HEAD}]),{owner:false,via:null});
 assert.deepEqual(ownerIntent(pr(BOT),[{user:OWNER,state:'APPROVED',commit_id:'c'.repeat(40)}]),{owner:false,via:null});
 assert.deepEqual(ownerIntent(pr(BOT),[{user:OWNER,state:'COMMENTED',commit_id:HEAD}]),{owner:false,via:null});
 assert.deepEqual(ownerIntent(pr(BOT),[{user:OWNER,state:'APPROVED',commit_id:HEAD}]),
  {owner:true,via:'owner-approved-exact-head'});
 assert.equal(isOwnerAccount({login:'michaeljwilliams0123',id:1}),false);
 assert.equal(isOwnerAccount({login:'michaeljwilliams0123',id:308995719,type:'Bot'}),false);
});
test('fork, closed, non-main or stale evidence PRs hold',()=>{
 for(const mutate of [p=>{p.head.repo={id:9,full_name:'evil/Ultron.MW'};},
   p=>{p.state='closed';},p=>{p.base.ref='release';},p=>{p.head.sha='x';}]){
  const p=pr();mutate(p);
  assert.equal(run({pr:p}).status,'held');
 }
 const e=evidence();e.report.sourceSha='c'.repeat(40);
 assert.equal(run(e).status,'held');
 const m=evidence();m.receipt.modelReview.results.Skeptic.verdict='hold';
 assert.equal(run(m).status,'held');
});
test('check run is pass only for proven results and is named for the ruleset',()=>{
 const ok=buildGateCheckRun(run(),{sha:HEAD,prNumber:PR,detailsUrl:'https://x'});
 assert.equal(ok.name,GATE_CHECK_NAME);
 assert.equal(ok.conclusion,'success');
 assert.equal(ok.head_sha,HEAD);
 assert.equal(buildGateCheckRun(null,{sha:HEAD,prNumber:PR}).conclusion,'failure');
 assert.equal(buildGateCheckRun(run(),{sha:'c'.repeat(40),prNumber:PR}).conclusion,'failure');
 assert.throws(()=>buildGateCheckRun(run(),{sha:'bad'}));
});
test('publisher requires the configured dedicated App identity',()=>{
 assert.equal(resolveGatePublisher({}),null);
 assert.equal(resolveGatePublisher({appId:'123',expectedSlug:'ultron-council-gate',mintedSlug:'github-actions'}),null);
 assert.equal(resolveGatePublisher({appId:'abc',expectedSlug:'ultron-council-gate',mintedSlug:'ultron-council-gate'}),null);
 assert.deepEqual(resolveGatePublisher({appId:'123',expectedSlug:'ultron-council-gate',
  mintedSlug:'ultron-council-gate'}),{appId:123,slug:'ultron-council-gate'});
});
test('trusted workflow loads only main, never runs PR code, and cannot forge via Actions (C1, C2)',()=>{
 const y=readFileSync(new URL('../.github/workflows/council-required-status.yml',import.meta.url),'utf8')
  .replace(/\r\n/g,'\n');
 assert.match(y,/\n  pull_request_target:\n/);
 assert.doesNotMatch(y,/\n  pull_request:\n|workflow_run:/);
 // Every checkout is main; the PR head is never fetched.
 const checkouts=[...y.matchAll(/actions\/checkout@[a-f0-9]{40}[^\n]*\n\s+with:\n\s+ref: ([^\n]+)/g)].map(m=>m[1]);
 assert.deepEqual(checkouts,['main']);
 assert.doesNotMatch(y,/pull_request\.head\.(?:sha|ref)\s*\}\}|refs\/pull\/|downloadArtifact|download-artifact/);
 // GITHUB_TOKEN can't write statuses or checks; only the App token publishes.
 assert.doesNotMatch(y,/^\s+(?:statuses|checks): write$|createCommitStatus/m);
 assert.match(y,/permission-checks: write/);
 assert.match(y,/github-token: \$\{\{ steps\.app\.outputs\.token \}\}/);
 assert.match(y,/core\.exportVariable\('ORIGINAL_SECURITY_SIGNAL',risk\.security/);
 assert.match(y,/core\.exportVariable\('OWNER_MODE',intent\.owner/);
 assert.doesNotMatch(y,/354634860|michaeljwilliams0123ultron/);
 assert.doesNotMatch(y,/\$\{\{\s*github\.event\.(?:pull_request|issue)\.(?:title|body)/);
 assert.match(y,/Fail closed when the Council Gate App is not configured[\s\S]*exit 1/);
});
