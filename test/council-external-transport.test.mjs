import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
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
  if(String(url)==='https://api.github.com/installation')
   return new Response(JSON.stringify({id:701,app_id:900}),
    {status:200,headers:{'content-type':'application/json'}});
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
  requireDistinctRepositoryInstallation:true,expectedInstallationId:701});
 assert.equal(result.status,200);
 assert.equal(result.installationId,701);
 assert.equal(result.text,'export const version = 3;');
 assert.equal(result.installationVerified,true);
 assert.equal(result.repositoryAccessVerified,true);
 assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.method==='GET'));
 assert.ok(calls.every(c=>c.auth==='Bearer private-server-token'));
});
test('RED C04 outbound: missing peer repo installation blocks direct read without attempting contents',async()=>{
 let count=0;
 const t=makeCouncilExternalTransport({
  githubInstallationToken:'private-server-token',
  fetchImpl:async(url)=>{count++;return new Response(JSON.stringify(
   String(url)==='https://api.github.com/installation'?
     {id:701,app_id:900}:
     {total_count:1,repositories:[{full_name:'michaeljwilliams0123/Ultron.MW'}]}
  ),{status:200});}
 });
 await assert.rejects(t.githubRead({repository:peer,sourceSha:sha,path:'src/task-relay-contract.mjs',
  expectedInstallationId:701}),
  /external-transport-peer-not-installed/);
 assert.equal(count,2);
});

test('C04 review: exact IPv4 reserved subnets preserve routable neighbors',()=>{
 for(const address of ['192.0.0.255','192.0.2.255'])
  assert.equal(publicIPv4(address),false,address);
 for(const address of ['192.0.1.1','192.0.3.1'])
  assert.equal(publicIPv4(address),true,address);
});
test('C04 review: a slow-drip HTTPS server cannot evade the absolute deadline',async()=>{
 let destroyCount=0;
 const transport=makeCouncilExternalTransport({
  totalTimeoutMs:25,
  dnsResolve:async()=>[{address:'8.8.8.8',family:4}],
  httpsRequest:()=>{
   const request=new EventEmitter();
   request.end=()=>{};
   request.destroy=err=>{
    destroyCount++;
    request.emit('error',err);
    request.emit('close');
   };
   return request;
  }
 });
 await assert.rejects(transport.webRead({
  url:'https://www.wikipedia.org/',method:'GET',
  redirect:'manual',maxBytes:65536,requirePublicIpAtConnection:true
 }),/external-transport-timeout/);
 assert.equal(destroyCount,1);
});

test('C04 review: hanging DNS resolution consumes the same absolute web deadline',async()=>{
 let socketCount=0;
 const t=makeCouncilExternalTransport({
  totalTimeoutMs:35,
  dnsResolve:async()=>new Promise(()=>{}),
  httpsRequest:()=>{socketCount++;throw Error('must not connect');}
 });
 await assert.rejects(t.webRead({url:'https://www.wikipedia.org/',
  method:'GET',redirect:'manual',maxBytes:65536,requirePublicIpAtConnection:true
 }),/external-transport-timeout/);
 assert.equal(socketCount,0);
});
test('C04 review: pinned lookup supports Node 20 all-address and single-address callback forms',async()=>{
 const t=makeCouncilExternalTransport({
  dnsResolve:async()=>[{address:'8.8.8.8',family:4}],
  httpsRequest:(_url,opts,_cb)=>{
   assert.equal(opts.autoSelectFamily,false);
   assert.equal(opts.family,4);
   opts.lookup('www.wikipedia.org',{all:true},(err,addresses)=>{
    assert.ifError(err);
    assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);
   });
   opts.lookup('www.wikipedia.org',{all:false},(err,address,family)=>{
    assert.ifError(err);
    assert.equal(address,'8.8.8.8');
    assert.equal(family,4);
   });
   const request=new EventEmitter();
   request.end=()=>request.destroy(Error('expected-test-stop'));
   request.destroy=e=>request.emit('error',e);
   return request;
  }
 });
 await assert.rejects(t.webRead({url:'https://www.wikipedia.org/',
  method:'GET',redirect:'manual',maxBytes:65536,requirePublicIpAtConnection:true
 }),/expected-test-stop/);
});
test('C04 review: issuance-bound installation identity rejects wrong actor without GitHub IO',async()=>{
 let calls=0;
 const t=makeCouncilExternalTransport({
  githubInstallationToken:'private-server-token',
  verifiedInstallationId:701,
  fetchImpl:async()=>{calls++;throw Error('unexpected GitHub read');}
 });
 await assert.rejects(t.githubRead({repository:peer,sourceSha:sha,
  path:'src/task-relay-contract.mjs',expectedInstallationId:702}),
  /external-transport-installation-identity-mismatch/);
 assert.equal(calls,0);
});
