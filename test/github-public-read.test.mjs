import test from 'node:test';
import assert from 'node:assert/strict';
import { readGithubPublic } from '../cloud/hatchable/lib/github-public-read.js';

function response(status, json={object:{sha:'f'.repeat(40)}}, headers={}) {
  return { ok:status>=200&&status<300, status,
    headers:{get(name){return headers[name.toLowerCase()]??null;}},
    async json(){return json;} };
}

test('live public GitHub read returns validated response body without retries', async()=>{
 const calls=[];
 const result=await readGithubPublic('/git/ref/heads/main', {
  fetchImpl:async(url,options)=>{calls.push({url,options});return response(200);},
  wait:async()=>{throw Error('unexpected-retry');}
 });
 assert.equal(result.object.sha,'f'.repeat(40));
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://api.github.com/repos/michaeljwilliams0123/Ultron.MW/git/ref/heads/main');
 assert.equal(calls[0].options.headers['User-Agent'],'UltronMW-Cloud-Brain');
});

test('a transient anonymous GitHub 403 gets exactly one bounded read-only retry',async()=>{
 let count=0;const delays=[];
 const result=await readGithubPublic('/git/ref/heads/main',{
  fetchImpl:async()=>++count===1?response(403,{}, {'x-ratelimit-remaining':'24'}):response(200),
  wait:async(ms)=>{delays.push(ms);}
 });
 assert.equal(result.object.sha,'f'.repeat(40));
 assert.equal(count,2);
 assert.deepEqual(delays,[350]);
});

test('persistent GitHub 403 fails closed without claiming success',async()=>{
 let count=0;
 await assert.rejects(readGithubPublic('/git/ref/heads/main',{
  fetchImpl:async()=>{count++;return response(403);},
  wait:async()=>{}
 }),/github-status-403/);
 assert.equal(count,2);
});

test('rate-exhausted GitHub 403 fails immediately rather than amplifying quota use',async()=>{
 let count=0;
 await assert.rejects(readGithubPublic('/git/ref/heads/main',{
  fetchImpl:async()=>{count++;return response(403,{}, {'x-ratelimit-remaining':'0'});},
  wait:async()=>{throw Error('no-wait');}
 }),/github-rate-limited/);
 assert.equal(count,1);
});

test('GitHub retry-after above one second is respected, without long in-request delay',async()=>{
 let count=0;
 await assert.rejects(readGithubPublic('/git/ref/heads/main',{
  fetchImpl:async()=>{count++;return response(429,{}, {'retry-after':'12'});},
  wait:async()=>{throw Error('no-wait');}
 }),/github-status-429/);
 assert.equal(count,1);
});

test('rejects non-repository paths without making network requests',async()=>{
 await assert.rejects(readGithubPublic('https://somewhere.invalid/',{
  fetchImpl:async()=>{throw Error('network-request-not-expected');}
 }),/github-path-invalid/);
});

test('authorization failures do not get retried or treated as public successes',async()=>{
 let count=0;
 await assert.rejects(readGithubPublic('/git/ref/heads/main',{
  fetchImpl:async()=>{count++;return response(401);},
  wait:async()=>{throw Error('no-wait');}
 }),/github-status-401/);
 assert.equal(count,1);
});
