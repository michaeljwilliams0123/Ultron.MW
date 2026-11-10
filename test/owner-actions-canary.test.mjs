import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runOwnerActionsCanary} from '../scripts/owner-actions-canary.mjs';

const SHA='a'.repeat(40),OTHER='b'.repeat(40);
const ROOT='https://api.github.com/repos/Ultron-MW/Ultron.MW';
const env={
 GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_REPOSITORY:'Ultron-MW/Ultron.MW',
 GITHUB_ACTOR:'michaeljwilliams0123',GITHUB_TRIGGERING_ACTOR:'michaeljwilliams0123',
 GITHUB_REF:'refs/heads/main',GITHUB_SHA:SHA,
 GITHUB_RUN_ID:'42818000001',GITHUB_RUN_ATTEMPT:'1',GITHUB_TOKEN:'SECRET_TOKEN_NEVER_PRINT'
};
const branch='ultron/canary-owner-actions-42818000001';
function json(status,body){
 return {ok:status>=200&&status<300,status,
   json:async()=>body,headers:{get:()=>null}};
}
function harness({preexisting=false,postReadbackSha=SHA,postStatus=201,
 wrongRepo=false,mainSha=SHA}={}){
 const calls=[];
 let reads=0;
 const request=async(url,opts)=>{
  calls.push({url,method:opts.method,body:opts.body});
  assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.Authorization,'Bearer '+env.GITHUB_TOKEN);
  if(url===ROOT&&opts.method==='GET')
   return json(200,{id:wrongRepo?1:1424939667,full_name:'Ultron-MW/Ultron.MW',
     default_branch:'main'});
  if(url===ROOT+'/git/ref/heads/main'&&opts.method==='GET')
   return json(200,{ref:'refs/heads/main',object:{type:'commit',sha:mainSha}});
  if(url===ROOT+'/git/ref/heads/'+branch&&opts.method==='GET'){
   reads++;
   return reads===1?
     (preexisting?json(200,{ref:'refs/heads/'+branch,object:{type:'commit',sha:SHA}}):json(404,{message:'Not Found'})):
     json(200,{ref:'refs/heads/'+branch,object:{type:'commit',sha:postReadbackSha}});
  }
  if(url===ROOT+'/git/refs'&&opts.method==='POST')
   return json(postStatus,{ref:'refs/heads/'+branch,object:{type:'commit',sha:SHA}});
  throw Error('unexpected network call '+opts.method+' '+url);
 };
 return {request,calls};
}
function createArgs(h){return {env,mode:'create',expectedSha:SHA,
 approvalPhrase:'APPROVE_ONE_OWNER_ACTIONS_CANARY',request:h.request};}

test('read-only mode verifies exact repository and HEAD with no mutation, and does not claim App identity',async()=>{
 const h=harness();
 const result=await runOwnerActionsCanary({env,mode:'read',request:h.request});
 assert.equal(result.status,'verified');
 assert.equal(result.operation,'repository.read');
 assert.equal(result.appPrincipalsVerified,0);
 assert.equal(result.externalWritePerformed,false);
 assert.equal(h.calls.some(c=>c.method==='POST'),false);
 assert.equal(JSON.stringify(result).includes(env.GITHUB_TOKEN),false);
});

test('explicit owner dispatch creates exactly one run-scoped isolated branch with independent readback',async()=>{
 const h=harness();
 const result=await runOwnerActionsCanary(createArgs(h));
 assert.equal(result.status,'verified');
 assert.equal(result.operation,'branch.create');
 assert.equal(result.branch,branch);
 assert.equal(result.sourceSha,SHA);
 assert.equal(result.executionPrincipal,'github-actions[bot]');
 assert.equal(result.appPrincipalsVerified,0);
 assert.equal(result.externalWritePerformed,true);
 assert.equal(result.remoteReadbackVerified,true);
 assert.equal(result.postgresReceiptVerified,false);
 assert.match(result.receiptDigest,/^[0-9a-f]{64}$/);
 assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
 const posted=JSON.parse(h.calls.find(c=>c.method==='POST').body);
 assert.deepEqual(posted,{ref:'refs/heads/'+branch,sha:SHA});
 assert.equal(JSON.stringify(result).includes(env.GITHUB_TOKEN),false);
});

test('denies non-owner actors, reruns, wrong repository, wrong branch, or missing approval before network',async()=>{
 const patches=[
  {GITHUB_ACTOR:'attacker'},
  {GITHUB_TRIGGERING_ACTOR:'attacker'},
  {GITHUB_REPOSITORY:'michaeljwilliams0123/Ultron.MW'},
  {GITHUB_REF:'refs/heads/feature'},
  {GITHUB_EVENT_NAME:'push'},
  {GITHUB_ACTIONS:'false'},
  {GITHUB_RUN_ATTEMPT:'2'},
  {GITHUB_RUN_ID:'abc'},
 ];
 for(const patch of patches){
  let called=false;
  const result=await runOwnerActionsCanary({env:{...env,...patch},mode:'create',
   expectedSha:SHA,approvalPhrase:'APPROVE_ONE_OWNER_ACTIONS_CANARY',
   request:async()=>{called=true;throw Error('should not call');}});
  assert.equal(result.status,'held');
  assert.equal(called,false);
 }
 for(const [approvalPhrase,expectedSha] of [['wrong',SHA],['APPROVE_ONE_OWNER_ACTIONS_CANARY',OTHER]]){
  let called=false;
  const result=await runOwnerActionsCanary({env,mode:'create',expectedSha,approvalPhrase,
   request:async()=>{called=true;throw Error('should not call');}});
  assert.equal(result.status,'held');
  assert.equal(called,false);
 }
});

test('repo identity drift, main SHA drift, preexisting ref, and remote mismatch cannot pass',async()=>{
 for(const options of [{wrongRepo:true},{mainSha:OTHER},{preexisting:true},
  {postReadbackSha:OTHER},{postStatus:403}]){
  const h=harness(options);
  const result=await runOwnerActionsCanary(createArgs(h));
  assert.equal(result.status,'held',JSON.stringify(options));
  assert.equal(result.remoteReadbackVerified,false,JSON.stringify(options));
  assert.equal(result.appPrincipalsVerified,0);
  if(options.wrongRepo||options.mainSha||options.preexisting)
   assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
 }
});

test('read errors and uncertain writes cannot be counted as verified',async()=>{
 const read=await runOwnerActionsCanary({env,mode:'read',
  request:async()=>{throw Error('SECRET_INTERNAL_API_ERROR');}});
 assert.equal(read.status,'held');
 assert.equal(JSON.stringify(read).includes('SECRET_INTERNAL_API_ERROR'),false);
 const h=harness();h.request=async(url,opts)=>{
  if(opts.method==='POST')throw Error('SECRET_INTERNAL_API_ERROR');
  return harnessResponse(url,opts);
 };
 // A lost acknowledgment is never proof of success.
 const lost=await runOwnerActionsCanary(createArgs(h));
 assert.equal(lost.status,'held');
 assert.equal(lost.externalWritePerformed,false);
 assert.equal(JSON.stringify(lost).includes('SECRET_INTERNAL_API_ERROR'),false);
 function harnessResponse(url,opts){
  if(url===ROOT)return json(200,{id:1424939667,full_name:'Ultron-MW/Ultron.MW',default_branch:'main'});
  if(url===ROOT+'/git/ref/heads/main')return json(200,{ref:'refs/heads/main',object:{type:'commit',sha:SHA}});
  if(url===ROOT+'/git/ref/heads/'+branch)return json(404,{message:'Not Found'});
  throw Error('unexpected call');
 }
});

test('workflow keeps a separate owner-gated, contents:write job and a read-only default',async()=>{
 const yml=await readFile(new URL('../.github/workflows/owner-actions-canary.yml',import.meta.url),'utf8');
 assert.match(yml,/workflow_dispatch:/);
 assert.match(yml,/default: read/);
 assert.match(yml,/APPROVE_ONE_OWNER_ACTIONS_CANARY/);
 assert.match(yml,/github\.repository == 'Ultron-MW\/Ultron\.MW'/);
 assert.match(yml,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(yml,/github\.triggering_actor == 'michaeljwilliams0123'/);
 assert.match(yml,/github\.ref == 'refs\/heads\/main'/);
 assert.match(yml,/contents: read/);
 assert.match(yml,/contents: write/);
 assert.match(yml,/node scripts\/owner-actions-canary\.mjs/);
 assert.match(yml,/artifacts\/owner-actions-canary-.*json/);
 assert.match(yml,/if: always\(\)/);
 assert.doesNotMatch(yml,/pull_request_target:|skip-token-revoke: true|id-token: write|actions: write|secrets\.ULTRON_BUILDER_PRIVATE_KEY/);
});
