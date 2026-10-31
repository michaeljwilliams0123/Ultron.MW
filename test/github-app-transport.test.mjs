import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnifiedGitHubTransport} from '../src/github-app-transport.mjs';
import {
 requiredTokenPermissions,ULTRON_REPOSITORY_ID,
} from '../src/github-principal-policy.mjs';

const ROOT='/repos/michaeljwilliams0123/Ultron.MW';
function token(operation,patch={}){
 return {token:'test-only-credential',operation,repositoryId:ULTRON_REPOSITORY_ID,
  installationId:9123,permissions:requiredTokenPermissions(operation),
  expiresAt:'2026-10-31T20:30:00Z',...patch};
}

test('authorized request mints one exact operation token and hides it from results',async()=>{
 const calls=[],requests=[];
 const operation='actions.verify.dispatch';
 const transport=createUnifiedGitHubTransport({expectedInstallationId:9123,
  clock:()=> '2026-10-31T20:00:00Z',
  getToken:async request=>{requests.push(request);return token(operation);},
  fetchImpl:async(url,init)=>{calls.push({url,init});return {
   ok:true,status:200,json:async()=>({state:'active'})};},
 });
 const result=await transport.request(operation,'GET',
  ROOT+'/actions/workflows/verify.yml');
 assert.deepEqual(result,{state:'active'});
 assert.equal(calls[0].url,'https://api.github.com'+ROOT+'/actions/workflows/verify.yml');
 assert.equal(calls[0].init.redirect,'error');
 assert.equal(calls[0].init.headers.Authorization,'Bearer test-only-credential');
 assert.deepEqual(requests[0],{operation,repositoryId:ULTRON_REPOSITORY_ID,
  permissions:{metadata:'read',contents:'read',actions:'write'}});
 assert.equal(JSON.stringify(result).includes('credential'),false);
});

test('operation-to-route fence rejects malformed and cross-profile paths before token mint',async()=>{
 let tokenCalls=0,fetchCalls=0;
 const transport=createUnifiedGitHubTransport({expectedInstallationId:9123,
  clock:()=> '2026-10-31T20:00:00Z',
  getToken:async request=>{tokenCalls++;return token(request.operation);},
  fetchImpl:async()=>{fetchCalls++;throw Error('unexpected network call');},
 });
 for(const [operation,method,path] of [
  ['actions.verify.dispatch','POST',ROOT+'/actions/runs/15/cancel'],
  ['actions.cancel','POST',ROOT+'/actions/workflows/verify.yml/dispatches'],
  ['repository.settings.update','DELETE',ROOT],
  ['webhooks.ping','POST','/repos/other/repo/hooks/15/pings'],
  ['actions.cancel','POST','https://malicious.example/admin'],
  ['actions.cancel','POST',ROOT+'/actions/runs/15/cancel?x=1'],
  ['actions.cancel','POST',ROOT+'/actions/runs/15/cancel#x'],
  ['actions.cancel','POST',ROOT+'/actions/runs/15/cancel\n'],
  ['actions.cancel','POST',ROOT+'/actions/runs/15/../cancel'],
  ['actions.cancel','POST',ROOT+'/actions/runs/%31%35/cancel'],
  ['actions.cancel','POST',ROOT+'/actions/runs/0/cancel'],
  ['actions.cancel','POST',ROOT+'/actions/runs/abc/cancel'],
  ['webhooks.ping','GET',ROOT+'/hooks/0'],
  ['webhooks.ping','GET',ROOT+'/hooks/abc'],
 ]) await assert.rejects(transport.request(operation,method,path),/denied/i);
 assert.equal(tokenCalls,0);
 assert.equal(fetchCalls,0);
});

test('token metadata must match repository, installation, operation and exact permissions',async()=>{
 const operation='repository.settings.update';
 for(const patch of [
  {repositoryId:1},{installationId:2},{operation:'actions.cancel'},
  {permissions:{metadata:'read',administration:'write',actions:'write'}},
  {expiresAt:'2026-10-31T20:30:00'},
  {expiresAt:'2026-10-31T21:00:01Z'}, {token:''},
 ]){
  let fetchCalls=0;
  const transport=createUnifiedGitHubTransport({expectedInstallationId:9123,
   clock:()=> '2026-10-31T20:00:00Z',
   getToken:async()=>token(operation,patch),
   fetchImpl:async()=>{fetchCalls++;throw Error('unexpected');},
  });
  await assert.rejects(transport.request(operation,'GET',ROOT),/profile unavailable/i);
  assert.equal(fetchCalls,0);
 }
});

test('network and HTTP failures surface as non-retryable transport errors',async()=>{
 const operation='actions.cancel',path=ROOT+'/actions/runs/15/cancel';
 for(const fetchImpl of [
  async()=>{throw Error('lost');},
  async()=>({ok:false,status:403}),
 ]){
  const transport=createUnifiedGitHubTransport({expectedInstallationId:9123,
   clock:()=> '2026-10-31T20:00:00Z',
   getToken:async()=>token(operation),fetchImpl});
  await assert.rejects(transport.request(operation,'POST',path),/outcome unknown|HTTP 403/);
 }
});
