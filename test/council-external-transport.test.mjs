import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCouncilExternalTransport,publicIPv4} from '../src/council-external-transport.mjs';
const peer='michaeljwilliams0123/mahoraga';
const sha='b'.repeat(40);
test('RED C04 outbound: no public transport without trusted resolver and GitHub installation',async()=>{
 const t=makeCouncilExternalTransport();
 await assert.rejects(t.webRead({url:'https://www.wikipedia.org/',method:'GET',
  redirect:'manual',maxBytes:65536,requirePublicIpAtConnection:true}),/external-transport-(unconfigured|disabled)/);
 await assert.rejects(t.githubRead({repository:peer,sourceSha:sha,
  path:'src/task-relay-contract.mjs'}),/external-transport-(unconfigured|disabled)/);
});
test('RED C04 outbound: deny private, reserved or unrouteable IPv4 DNS destinations',()=>{
 const denied=['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254',
  '172.16.0.2','172.31.255.255','192.168.0.1','100.64.0.1',
  '192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255'];
 for(const x of denied)assert.equal(publicIPv4(x),false,x);
 for(const x of ['8.8.8.8','1.1.1.1','93.184.215.14'])
  assert.equal(publicIPv4(x),true,x);
});
test('RED C04 outbound: pinned DNS egress rejects a private resolution before opening socket',async()=>{
 let calls=0;
 const t=makeCouncilExternalTransport({
  dnsResolve:async()=>[{address:'127.0.0.1',family:4}],
  httpsRequest:()=>{calls++;throw Error('socket must never be attempted');}
 });
 await assert.rejects(t.webRead({url:'https://www.wikipedia.org/',method:'GET',
  redirect:'manual',maxBytes:65536,requirePublicIpAtConnection:true}),/external-transport-private-egress/);
 assert.equal(calls,0);
});
test('RED C04 outbound: GitHub App token must explicitly list Mahoraga and return exact file',async()=>{
 const calls=[];
 const mock=async(url,init)=>{
  calls.push({url:String(url),method:init.method,auth:init.headers.authorization});
  if(String(url).endsWith('/installation/repositories?per_page=100&page=1'))
   return new Response(JSON.stringify({total_count:1,repositories:[{full_name:peer}]}),
    {status:200,headers:{'content-type':'application/json'}});
  if(String(url).includes('/repos/michaeljwilliams0123/mahoraga/contents/'))
   return new Response(JSON.stringify({type:'file',path:'src/task-relay-contract.mjs',
    encoding:'base64',content:Buffer.from('export const version = 3;').toString('base64')}),
    {status:200,headers:{'content-type':'application/json'}});
  throw Error('unexpected url '+url);
 };
 const t=makeCouncilExternalTransport({githubInstallationToken:'private-server-token',
  fetchImpl:mock});
 const result=await t.githubRead({repository:peer,sourceSha:sha,
  path:'src/task-relay-contract.mjs',requiredPermission:'contents:read',
  requireDistinctRepositoryInstallation:true});
 assert.equal(result.status,200);
 assert.equal(result.text,'export const version = 3;');
 assert.equal(result.installationVerified,true);
 assert.equal(result.repositoryAccessVerified,true);
 assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c.method==='GET'));
 assert.ok(calls.every(c=>c.auth==='Bearer private-server-token'));
});
test('RED C04 outbound: missing peer repo installation blocks direct read without attempting contents',async()=>{
 let count=0;
 const t=makeCouncilExternalTransport({
  githubInstallationToken:'private-server-token',
  fetchImpl:async()=>{count++;return new Response(JSON.stringify({
   total_count:1,repositories:[{full_name:'michaeljwilliams0123/Ultron.MW'}]}),{status:200});}
 });
 await assert.rejects(t.githubRead({repository:peer,sourceSha:sha,path:'src/task-relay-contract.mjs'}),
  /external-transport-peer-not-installed/);
 assert.equal(count,1);
});
