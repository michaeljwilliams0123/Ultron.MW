import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAuthenticatedGithubReleaseFetch} from '../cloud/hatchable/lib/github-operator-release-fetch.js';

const API='https://api.github.com/repos/michaeljwilliams0123/Ultron.MW';
const SHA='3cad23a429d00426fe48a752d73d30c0aafdbb94';

test('release readback uses existing authenticated github_operator proxy; never anonymous fetch',async()=>{
 const seen=[];
 const fetchGithub=createAuthenticatedGithubReleaseFetch({call:async(name,req)=>{
  seen.push({name,req});
  return {status:200,body:{object:{sha:SHA}},headers:{}};
 }});
 const response=await fetchGithub(API+'/git/ref/heads/main',{method:'GET'});
 assert.equal(response.ok,true);
 assert.equal(response.status,200);
 assert.equal((await response.json()).object.sha,SHA);
 assert.deepEqual(seen,[{name:'github_operator',req:{
  method:'GET',path:'/repos/michaeljwilliams0123/Ultron.MW/git/ref/heads/main'
 }}]);
});

test('query parameters and Link pagination header are retained for fail-closed validation',async()=>{
 const upstream='<' + API+'/commits/'+SHA+'/pulls?per_page=100&page=2>; rel="next"';
 let captured=null;
 const f=createAuthenticatedGithubReleaseFetch({call:async(n,r)=>{
  captured={n,r};
  return {status:200,body:[{number:519}],headers:{link:upstream}};
 }});
 const response=await f(API+'/commits/'+SHA+'/pulls?per_page=100&page=1');
 assert.deepEqual(captured,{n:'github_operator',r:{method:'GET',
  path:'/repos/michaeljwilliams0123/Ultron.MW/commits/'+SHA+'/pulls',
  query:{per_page:'100',page:'1'}}});
 assert.equal(response.headers.get('link'),upstream);
 assert.deepEqual(await response.json(),[{number:519}]);
});

test('fail closed on lost OAuth authorization and malformed upstream responses',async()=>{
 const f=createAuthenticatedGithubReleaseFetch({call:async()=>({status:401,body:{message:'bad credentials'}})});
 const r=await f(API+'/pulls/519');
 assert.equal(r.ok,false);
 assert.equal(r.status,401);
 const noCall=createAuthenticatedGithubReleaseFetch();
 await assert.rejects(()=>noCall(API+'/pulls/519'),/unavailable/);
});

test('never forward credentials to foreign repo, URLs, write methods or hidden query parameters',async()=>{
 let calls=0;
 const f=createAuthenticatedGithubReleaseFetch({call:async()=>{calls++;return {status:200,body:{}};}});
 for(const url of [
  'https://api.github.com/user',
  'https://evil.example/repos/michaeljwilliams0123/Ultron.MW',
  'http://api.github.com/repos/michaeljwilliams0123/Ultron.MW/pulls',
  API+'-attacker/pulls',
  API+'/pulls?access_token=x',
  API+'/pulls?per_page=1&per_page=100',
  API+'/pulls#fragment',
  API+'/pulls?foo=bar',
 ])await assert.rejects(()=>f(url),/out-of-scope/);
 await assert.rejects(()=>f(API+'/pulls',{method:'POST'}),/out-of-scope/);
 assert.equal(calls,0);
});

test('release handler wires authenticated operator into both CI and Council reads',()=>{
 const source=readFileSync(new URL('../cloud/hatchable/lib/release-proof-readback.js',import.meta.url),'utf8');
 assert.match(source,/createAuthenticatedGithubReleaseFetch/);
 assert.match(source,/collectConnectivity\(\{db,fetchGithub/);
 assert.match(source,/collectMergedCouncilReadback\(\{commitSha:sha,fetchGithub/);
});
test('reject encoded paths and any GitHub endpoints outside release evidence',async()=>{
 let calls=0;
 const f=createAuthenticatedGithubReleaseFetch({call:async()=>{
  calls++;return {status:200,body:{}};}});
 for(const url of [
  API+'/%2e%2e/%2e%2e/user',
  API+'/commits/'+SHA+'/%2fpulls',
  API+'/commits/'+SHA+'/%5cpulls',
  API+'/contents/.github/workflows/verify.yml',
  API+'/hooks',
  API+'/collaborators',
  API+'/actions/runs/123/logs',
  API+'//pulls',
  API+'/actions/workflows/other.yml/runs',
 ])await assert.rejects(()=>f(url),/out-of-scope/);
 assert.equal(calls,0);
});
test('validate scoped query values before invoking the OAuth proxy',async()=>{
 let calls=0;
 const f=createAuthenticatedGithubReleaseFetch({call:async()=>{
  calls++;return {status:200,body:{}};}});
 for(const url of [
  API+'/pulls?per_page=101',
  API+'/pulls?per_page=0',
  API+'/pulls?page=0',
  API+'/pulls?state=closed',
  API+'/pulls?state=%2e%2e',
  API+'/pulls?branch=other',
  API+'/pulls?event=workflow_dispatch',
  API+'/pulls?sort=../x',
  API+'/commits/'+SHA+'/check-runs?check_name=another/check',
 ])await assert.rejects(()=>f(url),/out-of-scope/);
 assert.equal(calls,0);
});
test('OAuth proxy failures are redacted and malformed upstream status is rejected',async()=>{
 const failed=createAuthenticatedGithubReleaseFetch({call:async()=>{
  throw Error('sensitive-provider-message-should-not-escape');
 }});
 await assert.rejects(()=>failed(API+'/pulls/519'),error=>
  error.message==='authenticated-github-readback-unavailable');
 const broken=createAuthenticatedGithubReleaseFetch({call:async()=>({body:{}})});
 await assert.rejects(()=>broken(API+'/pulls/519'),
  /authenticated-github-readback-unavailable/);
});

test('exact commit readback remains scoped to canonical repository and full SHA',async()=>{
 let calls=0;
 const f=createAuthenticatedGithubReleaseFetch({call:async(name,req)=>{calls++;assert.equal(req.path,'/repos/michaeljwilliams0123/Ultron.MW/commits/'+SHA);return {status:200,body:{sha:SHA}};}});
 assert.equal((await (await f(API+'/commits/'+SHA)).json()).sha,SHA);
 await assert.rejects(()=>f(API+'/commits/main'),/out-of-scope/);
 await assert.rejects(()=>f(API+'/commits/'+SHA,{method:'POST'}),/out-of-scope/);
 assert.equal(calls,1);
});
