import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Review the exact PR module without executing a provider action.
const source=(await readFile(new URL('../cloud/hatchable/lib/github-pr-comment-canary.js',import.meta.url),'utf8'))
 .replace("'lib/rsa-pkcs1-sign.js'",JSON.stringify(new URL('../cloud/hatchable/lib/rsa-pkcs1-sign.js',import.meta.url).href));
const {
 canonicalCanaryComment,validatePreparedCanary,classifyPrCommentFailure,
 safeGithubPermissionSignal,reconcilePrCommentCanary
}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const NUMBER=478;
const KEY='ultron-task-c04-pr478-'+'a'.repeat(24);
const DIGEST='d'.repeat(64);
function prepared(){
 const commentBody=canonicalCanaryComment({pullRequest:NUMBER,idempotencyKey:KEY});
 return {pullRequest:NUMBER,idempotencyKey:KEY,commentBody,
  bodySha256:createHash('sha256').update(commentBody).digest('hex')};
}
function fakeReconcile({state='reconcile_required',storedDigest=DIGEST,status=200}={}){
 let gets=0,posts=0,queries=0;
 const p=prepared();
 const receipt={case:'existing-completion'};
 const db={async query(sql){
  queries++;
  if(sql.includes('SELECT idempotency_key,state,operation_digest'))
   return {rows:[{state,operation_digest:storedDigest,target_number:NUMBER,
    body_sha256:p.bodySha256,created_at:new Date().toISOString(),receipt}]};
  if(sql.includes('INSERT INTO brain_events'))return {rows:[{id:3}]};
  if(sql.includes("SET state='reconcile_required'"))return {rows:[]};
  if(sql.includes('WITH denial AS'))return {rows:[{claims:0,events:0}]};
  throw Error('Unexpected database query (test harness)');
 }};
 const fetchImpl=async(url,options={})=>{
  if((options.method||'GET')==='POST'){posts++;throw Error('unexpected POST');}
  gets++;assert.match(url,/\/issues\/478\/comments\?/);
  return {status,json:async()=>[]};
 };
 return {db,fetchImpl,p,receipt,gets:()=>gets,posts:()=>posts,queries:()=>queries};
}

test('fivefold C04: canonical body binds PR, marker and no automatic retry intent',()=>{
 const p=prepared();
 assert.match(p.commentBody,/C04 owner-signed Coordinator App canary for #478/);
 assert.ok(p.commentBody.includes('ultron-c04-owner-app-canary:'+KEY));
 assert.match(p.commentBody,/no automatic retry/);
 assert.equal((p.commentBody.match(/ultron-c04-owner-app-canary/g)||[]).length,1);
});
test('fivefold C04: canonical creation rejects nonpositive and out-of-bound PR numbers',()=>{
 for(const number of [0,-1,1000000000,1.5,Number.MAX_SAFE_INTEGER,'478',null])
  assert.throws(()=>canonicalCanaryComment({pullRequest:number,idempotencyKey:KEY}),/request-invalid/);
});
test('fivefold C04: canonical creation rejects forged or malformed operation keys',()=>{
 for(const key of ['',KEY.toUpperCase(),KEY+'x',
  'ultron-task-c04-pr479-'+'a'.repeat(23),'../'+KEY,123,null])
  assert.throws(()=>canonicalCanaryComment({pullRequest:NUMBER,idempotencyKey:key}),/request-invalid/);
});
test('fivefold C04: exact prepared payload is frozen and strips only permitted grant metadata',()=>{
 const p=prepared();
 assert.deepEqual(validatePreparedCanary(p),p);
 const withGrant={...p,ownerGrantRequest:{operation:'pr.comment'}};
 assert.deepEqual(Object.keys(validatePreparedCanary(withGrant)).sort(),Object.keys(p).sort());
 assert.ok(Object.isFrozen(validatePreparedCanary(p)));
});
test('fivefold C04: comment-body substitution is never accepted with an old digest',()=>{
 const p=prepared();
 for(const body of [p.commentBody+' changed',p.commentBody.replace('#478','#479'),'']){
  assert.throws(()=>validatePreparedCanary({...p,commentBody:body}),/request-invalid/);
 }
});
test('fivefold C04: mismatched or syntactically invalid body digests are rejected',()=>{
 const p=prepared();
 for(const digest of ['e'.repeat(64),'A'.repeat(64),'f'.repeat(63),'',null])
  assert.throws(()=>validatePreparedCanary({...p,bodySha256:digest}),/request-invalid/);
});
test('fivefold C04: extraneous signed-operation fields are not admitted',()=>{
 for(const field of [{token:'untrusted'},{providerStatus:201},{role:'admin'},{ownerGrantRequest:{},extra:1}])
  assert.throws(()=>validatePreparedCanary({...prepared(),...field}),/request-invalid/);
});
test('fivefold C04: actual provider 403 is preserved with bounded allowlisted signal',()=>{
 const e=Error('github-pr-comment-canary-provider-write-denied');
 e.providerHttpStatus=403;e.providerPermissionHint='issues-write';
 assert.deepEqual(classifyPrCommentFailure(e),{
  stage:'provider_write',reason:'provider-write-denied',dispatched:null,
  providerHttpStatus:403,permissionHint:'issues-write'
 });
});
test('fivefold C04: non-error HTTP status cannot impersonate durable denial',()=>{
 for(const status of [0,200,201,399,600,NaN,'403',null]){
  const e=Error('github-pr-comment-canary-provider-write-denied');
  e.providerHttpStatus=status;
  assert.ok(!('providerHttpStatus' in classifyPrCommentFailure(e)));
 }
});
test('fivefold C04: untrusted response payload and permission hints never enter diagnostics',()=>{
 const e=Error('Bearer ghp_'+'z'.repeat(30));
 e.providerHttpStatus=403;e.providerPermissionHint='Bearer confidential';
 assert.deepEqual(classifyPrCommentFailure(e),{stage:'unknown',reason:'unclassified',dispatched:null});
 const denial=Error('github-pr-comment-canary-provider-write-denied');
 denial.providerHttpStatus=403;denial.providerPermissionHint='Bearer secret';
 denial.body='Bearer secret';denial.headers={'authorization':'Bearer secret'};
 assert.doesNotMatch(JSON.stringify(classifyPrCommentFailure(denial)),/Bearer|secret/i);
});
test('fivefold C04: GitHub Issues permissions are mapped to bounded classification',()=>{
 assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':'issues=write'})),'issues-write');
 assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':'pull_requests=write'})),'pull-requests-write');
});
test('fivefold C04: only both exact provider permissions create the either-write hint',()=>{
 for(const header of ['issues=write;pull_requests=write','pull_requests=write,issues=write']){
  assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':header})),
   'issues-or-pull-requests-write');
 }
 for(const value of ['issues=admin','issues=write;secret=read','Bearer '+ 'k'.repeat(50),''])
  assert.equal(safeGithubPermissionSignal(new Headers({'x-accepted-github-permissions':value})),null);
});
test('fivefold C04: completed ledger readback returns durable receipt without provider activity',async()=>{
 const t=fakeReconcile({state:'completed'});
 const r=await reconcilePrCommentCanary({db:t.db,prepared:t.p,operationDigest:DIGEST,fetchImpl:t.fetchImpl});
 assert.deepEqual(r,{status:'recovered_success',receipt:t.receipt});
 assert.equal(t.gets(),0);assert.equal(t.posts(),0);
});
test('fivefold C04: immutable denied-no-effect state cannot be reconciled or replayed',async()=>{
 const t=fakeReconcile({state:'denied_no_effect'});
 await assert.rejects(reconcilePrCommentCanary({db:t.db,prepared:t.p,
  operationDigest:DIGEST,fetchImpl:t.fetchImpl}),/reconciliation-not-admitted/);
 assert.equal(t.gets(),0);assert.equal(t.posts(),0);
});
test('fivefold C04: operation digest mismatch is rejected before external reads',async()=>{
 const t=fakeReconcile({storedDigest:'e'.repeat(64)});
 await assert.rejects(reconcilePrCommentCanary({db:t.db,prepared:t.p,
  operationDigest:DIGEST,fetchImpl:t.fetchImpl}),/intent-conflict/);
 assert.equal(t.gets(),0);assert.equal(t.posts(),0);
});
test('fivefold C04: GitHub 503 readback retains unresolved outcome and never posts',async()=>{
 const t=fakeReconcile({status:503});
 await assert.rejects(reconcilePrCommentCanary({db:t.db,prepared:t.p,
  operationDigest:DIGEST,fetchImpl:t.fetchImpl}),/readback-unavailable/);
 assert.equal(t.gets(),1);assert.equal(t.posts(),0);
});
