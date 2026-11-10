import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {createVerifiedGitHubClient} from '../src/auth/identity-factory.mjs';
import {createUnifiedGitHubTransport} from '../src/github-app-transport.mjs';
import {
 GITHUB_OPERATION_PROFILES,operationProfile,requiredTokenPermissions,
 ULTRON_REPOSITORY,ULTRON_REPOSITORY_ID,
} from '../src/github-principal-policy.mjs';

const NOW=Date.parse('2026-11-09T20:00:00Z');
const API='https://api.github.com';
const REPO_PATH='/repos/'+ULTRON_REPOSITORY;
const RSA=generateKeyPairSync('rsa',{modulusLength:2048});
const env=Object.freeze({
 GITHUB_APP_ID:'12345',GITHUB_INSTALLATION_ID:'9123',
 GITHUB_PRIVATE_KEY:RSA.privateKey.export({type:'pkcs1',format:'pem'}).toString(),
});
function mockGitHub({
 repository={id:ULTRON_REPOSITORY_ID,full_name:ULTRON_REPOSITORY},
 repoStatus=200,tokenPatch={},failAt=null,
}={}){
 const calls=[];
 const fetchImpl=async(url,request)=>{
  const isExchange=url===API+'/app/installations/9123/access_tokens';
  const isRead=url===API+REPO_PATH;
  assert.ok(isExchange||isRead,'unexpected endpoint');
  calls.push({url,request});
  if(failAt===(isExchange?'exchange':'read'))throw Error('deliberate transport error');
  if(isExchange){
   const body=JSON.parse(request.body);
   return {ok:true,status:201,json:async()=>({
    token:'opaque-'+ 'A'.repeat(1500),
    expires_at:new Date(NOW+45*60_000).toISOString(),
    permissions:body.permissions,
    repositories:[{id:ULTRON_REPOSITORY_ID,full_name:ULTRON_REPOSITORY}],
    ...tokenPatch,
   })};
  }
  return {ok:repoStatus===200,status:repoStatus,json:async()=>repository};
 };
 return {calls,fetchImpl};
}
function makeClient(api){
 return createVerifiedGitHubClient({
  env,fetchImpl:api.fetchImpl,clock:()=>NOW,
 });
}

test('factory grant plugs directly into governed transport without bypassing policy',async()=>{
 const mock=mockGitHub();
 const factory=await makeClient(mock);
 const transport=createUnifiedGitHubTransport({
  getToken:factory.getTokenForScope,
  expectedInstallationId:factory.installationId,
  clock:()=>new Date(NOW).toISOString(),
  fetchImpl:mock.fetchImpl,
 });
 const repo=await transport.request('identity.read','GET',REPO_PATH);
 assert.equal(repo.id,ULTRON_REPOSITORY_ID);
 assert.equal(repo.full_name,ULTRON_REPOSITORY);
 const exchanges=mock.calls.filter(x=>x.url.includes('/access_tokens'));
 assert.deepEqual(exchanges.at(-1)&&JSON.parse(exchanges.at(-1).request.body),{
  repository_ids:[ULTRON_REPOSITORY_ID],permissions:{metadata:'read'}
 });
 assert.ok(mock.calls.every(x=>x.url===API+REPO_PATH||
   x.url===API+'/app/installations/9123/access_tokens'));
 assert.equal(mock.calls.filter(x=>x.request.method==='GET').length,2);
 assert.equal(mock.calls.filter(x=>x.request.method==='PATCH'||x.request.method==='PUT').length,0);
});

test('factory accepts only canonical object scopes when called by transport',async()=>{
 const mock=mockGitHub(),factory=await makeClient(mock);
 const base={operation:'repair.branch.create',repositoryId:ULTRON_REPOSITORY_ID,
  permissions:requiredTokenPermissions('repair.branch.create')};
 const grant=await factory.getTokenForScope(base);
 assert.deepEqual(grant.permissions,base.permissions);
 const before=mock.calls.length;
 for(const scope of [
  {...base,repositoryId:10},{...base,permissions:{metadata:'read',contents:'read'}},
  {...base,permissions:{metadata:'read',contents:'write',issues:'write'}},
  {...base,extraneous:true},
  {operation:'repository.settings.update',repositoryId:ULTRON_REPOSITORY_ID,
   permissions:requiredTokenPermissions('repository.settings.update')},
  {operation:'__proto__',repositoryId:ULTRON_REPOSITORY_ID,permissions:{}}
 ]) await assert.rejects(factory.getTokenForScope(scope),/denied|scope|admitted/i);
 assert.equal(mock.calls.length,before,'invalid scopes must never mint tokens');
});

test('all admitted standing profiles downscope exactly; step-up profiles deny before mint',async()=>{
 const mock=mockGitHub(),factory=await makeClient(mock);
 for(const operation of GITHUB_OPERATION_PROFILES){
  const before=mock.calls.length;
  if(operationProfile(operation).authorization==='step-up'){
   await assert.rejects(factory.getTokenForScope(operation),/denied/i);
   assert.equal(mock.calls.length,before);
  }else{
   const grant=await factory.getTokenForScope(operation);
   assert.equal(grant.operation,operation);
   assert.deepEqual(grant.permissions,requiredTokenPermissions(operation));
   assert.equal(grant.repositoryId,ULTRON_REPOSITORY_ID);
   assert.equal(mock.calls.length,before+1);
  }
 }
});

test('every minted App JWT carries valid RSA signature and bounded issuance time',async()=>{
 const mock=mockGitHub();
 await makeClient(mock);
 for(const call of mock.calls.filter(x=>x.url.includes('/access_tokens'))){
  const jwt=call.request.headers.Authorization.slice('Bearer '.length);
  const [header,payload,signature]=jwt.split('.');
  assert.ok(header&&payload&&signature);
  assert.equal(JSON.parse(Buffer.from(header,'base64url')).alg,'RS256');
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  assert.equal(claims.iss,'12345');
  assert.equal(claims.iat,Math.floor(NOW/1000)-30);
  assert.equal(claims.exp,Math.floor(NOW/1000)+540);
  assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),
   RSA.publicKey,Buffer.from(signature,'base64url')),true);
 }
});

test('startup denies HTTP failures and malformed GitHub grant readback',async()=>{
 for(const options of [
  {repoStatus:403},{failAt:'read'},{failAt:'exchange'},
  {tokenPatch:{repositories:[
   {id:ULTRON_REPOSITORY_ID,full_name:ULTRON_REPOSITORY},
   {id:99,full_name:'other/other'}]}},
  {tokenPatch:{permissions:{metadata:'read',issues:'write'}}},
  {tokenPatch:{expires_at:new Date(NOW+90*60_000).toISOString()}},
  {repository:{id:ULTRON_REPOSITORY_ID,full_name:'other/repo'}},
 ]){
  const mock=mockGitHub(options);
  await assert.rejects(makeClient(mock),/HTTP 403|outcome unknown|denied|scope|profile|identity|readback|unavailable/i);
  assert.equal(mock.calls.filter(x=>x.request.method==='PATCH'||x.request.method==='PUT').length,0);
 }
});

test('caller cannot retag a scoped grant while token exchange is pending',async()=>{
 const mock=mockGitHub();
 let block=false,release;
 const suspended=new Promise(resolve=>{release=resolve;});
 const fetchImpl=async(url,options)=>{
  if(block&&url.includes('/access_tokens'))await suspended;
  return mock.fetchImpl(url,options);
 };
 const factory=await createVerifiedGitHubClient({env,fetchImpl,clock:()=>NOW});
 const scope={operation:'identity.read',repositoryId:ULTRON_REPOSITORY_ID,
  permissions:{metadata:'read'}};
 block=true;
 const pending=factory.getTokenForScope(scope);
 scope.operation='repair.branch.create';
 scope.permissions.contents='write';
 release();
 const grant=await pending;
 assert.equal(grant.operation,'identity.read');
 assert.deepEqual(grant.permissions,{metadata:'read'});
 assert.equal(grant.repositoryId,ULTRON_REPOSITORY_ID);
});
