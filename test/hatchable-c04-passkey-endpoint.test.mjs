import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const state={effect:0,reserve:0,prepare:0,probe:null};
globalThis.__ultronC04PasskeyTest=state;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const hatch=url("export const db={query(){throw Error('unexpected')}}; export const config={get:async k=>k==='ULTRON_GITHUB_APP_ID'?'5633654':k==='ULTRON_GITHUB_INSTALLATION_ID'?'179066535':k==='ULTRON_GITHUB_APP_PRIVATE_KEY'?'BEGIN PRIVATE KEY':null};");
const canary=url("export const validatePreparedCanary=v=>v;export const prCommentCanaryReadiness=async()=>({enabled:true,configured:true});export const prCommentCanaryEnabled=async()=>true;export const diagnosePrCommentCanary=async()=>globalThis.__ultronC04PasskeyTest.probe;export const classifyPrCommentFailure=()=>({stage:'unknown',reason:'unclassified',dispatched:null});export const submitPrCommentCanary=async()=>{globalThis.__ultronC04PasskeyTest.effect++;return {status:'success',receipt:{details:{commentUrl:'https://github.com/michaeljwilliams0123/Ultron.MW/pull/460#issuecomment-1',remoteVerified:true}}}};");
const passkey=url("export const beginC04PasskeyChallenge=async()=>{globalThis.__ultronC04PasskeyTest.prepare++;return {ok:true,status:'prepared',grantId:'passkey-test',challenge:'test'}};export const verifyAndReserveC04Passkey=async()=>{globalThis.__ultronC04PasskeyTest.reserve++;return {ok:true,status:'reserved',operationDigest:'a'.repeat(64)}};");
const source=(await readFile(new URL('../cloud/hatchable/api/brain/github-pr-comment-passkey.js',import.meta.url),'utf8'))
 .replace("from 'hatchable'",'from '+JSON.stringify(hatch))
 .replace("from 'lib/github-pr-comment-canary.js'",'from '+JSON.stringify(canary))
 .replace("from 'lib/c04-passkey-comment.js'",'from '+JSON.stringify(passkey));
const handler=(await import(url(source))).default;
const prepared={pullRequest:460,idempotencyKey:'ultron-task-c04-pr460-'+'a'.repeat(24),
 bodySha256:'b'.repeat(64),commentBody:'bounded one comment'};
const proof={grantId:'passkey-test'};
function request({owner=true,origin=true,mode='submit'}={}){
 return {method:'POST',member:{handle:owner?'michaeljwilliams0123':'other'},
 headers:{origin:origin?'https://ultron-mw-cloud.hatchable.site':'https://attacker.invalid'},
 body:mode==='submit'?{mode,prepared,proof}:{mode,prepared,credentialId:'c'.repeat(24),
 expectedProfileVersion:7,expectedStopVersion:5}};
}
async function call(req){const res={code:0,setHeader(){return this;},
 status(code){this.code=code;return this;},json(body){return {status:this.code,body};}};
 return handler(req,res);}
const ready=()=>({readOnly:true,repositoryHttpStatus:200,issueHttpStatus:200,
 repositoryArchived:false,issueLocked:false,issueState:'open',isPullRequest:true});
const reset=()=>{state.reserve=0;state.effect=0;state.prepare=0;state.probe=ready();};
test('C04 passkey API denies nonowner and noncanonical browser origins before effects',async()=>{
 reset();assert.equal((await call(request({owner:false}))).status,403);
 assert.equal((await call(request({origin:false}))).status,403);
 assert.equal(state.reserve,0);assert.equal(state.effect,0);
});
test('C04 passkey API declines a closed or locked PR before consuming WebAuthn',async()=>{
 reset();state.probe={...ready(),issueState:'closed'};
 const x=await call(request());assert.equal(x.status,409);
 assert.equal(x.body.reason,'target-not-open-or-unlocked');
 assert.equal(state.reserve,0);assert.equal(state.effect,0);
 reset();state.probe={...ready(),issueLocked:true};
 assert.equal((await call(request())).status,409);
 assert.equal(state.reserve,0);assert.equal(state.effect,0);
});
test('C04 passkey prepare does not reserve or post a provider comment',async()=>{
 reset();const x=await call(request({mode:'prepare'}));
 assert.equal(x.status,200);assert.equal(state.prepare,1);
 assert.equal(state.reserve,0);assert.equal(state.effect,0);
});
test('C04 passkey approved path performs exactly one reservation then one provider call',async()=>{
 reset();const x=await call(request());
 assert.equal(x.status,201);assert.equal(x.body.receipt.details.remoteVerified,true);
 assert.equal(state.reserve,1);assert.equal(state.effect,1);
});
