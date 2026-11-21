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
 const source=readFileSync(new URL('../cloud/hatchable/api/brain/release-proof.js',import.meta.url),'utf8');
 assert.match(source,/createAuthenticatedGithubReleaseFetch/);
 assert.match(source,/collectConnectivity\(\{db,fetchGithub/);
 assert.match(source,/collectMergedCouncilReadback\(\{commitSha:sha,fetchGithub/);
});