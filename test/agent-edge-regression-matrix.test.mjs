import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runAgentAcceptance, acceptancePlan} from '../scripts/agent-http-acceptance.mjs';
import {unsupportedDiscoveryResponse} from '../cloudflare/edge-shield/src/discovery-policy.ts';

// Independent, fixed public contract. No external HTTP, credentials or provider usage.
const names=['AGENTS.md','agent-guide.html','agent-guide.md','glossary.md','llms-full.txt','llms.txt','sitemap.md','sitemap.xml','robots.txt'];
const discovery=['ucp','oauth-authorization-server','api-catalog','http-message-signatures-directory'];
const docs=new Map(names.map(name=>['/'+name,readFileSync(new URL('../cloud/hatchable/public/'+name,import.meta.url))]));
const plan=acceptancePlan();
const budget=18*65536;
const base={target:'edge',budgetBytes:budget,sourceSha:'a'.repeat(40),deployment:'fixture'};
const mime=p=>p.endsWith('.md')?'text/markdown':p.endsWith('.xml')?'application/xml':p.endsWith('.html')?'text/html':'text/plain';
function valid(item){
  if(item.kind==='doc')return new Response(docs.get(item.path),{headers:{'content-type':mime(item.path)}});
  if(item.kind==='protected')return new Response(null,{status:403});
  return new Response(item.method==='HEAD'?null:'{"error":"not_found"}',{status:404,headers:{'content-type':'application/json','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
}
const label=item=>item.method+' '+item.path;
async function probeAt(index, replacement, expected, options={}){
  const calls=[];
  const result=await runAgentAcceptance({...base,...options,fetcher:async(url,init)=>{
    const item=plan[calls.length];
    calls.push({url,init});
    return calls.length===index+1?replacement(item):valid(item);
  }});
  // Assert outside the harness catch boundary, so fixture assertion failures
  // cannot be misclassified as a passing transport-failure test.
  for(const [i,{url,init}] of calls.entries()){
    assert.equal(new URL(url).hostname,base.target==='edge'?'ultron-edge-shield.mahoraga-mjw0123.workers.dev':'ultron-mw-cloud.hatchable.site');
    assert.equal(new URL(url).pathname,plan[i].path);
    assert.equal(init.method,plan[i].method);
    assert.equal(init.credentials,'omit');
    assert.equal(init.redirect,'manual');
    assert.equal(init.cache,'no-store');
    assert.equal(init.headers['accept-encoding'],'identity');
    assert.equal('authorization' in init.headers,false);
    assert.equal(init.signal.aborted,false);
  }
  assert.equal(result.status,expected.status);
  assert.equal(result.reason,expected.reason);
  assert.equal(result.requested,index+1);
  assert.equal(calls.length,index+1);
  assert.equal(result.checks.length,index+1);
  assert.equal(result.checks.at(-1).passed,false);
  assert.ok(result.checks.slice(0,-1).every(c=>c.passed));
  assert.equal(result.deploymentIdentityVerified,false);
  assert.equal(result.providerMeterVerified,false);
  return result;
}
const failed={status:'failed',reason:'contract-mismatch'};
const held=reason=>({status:'held',reason});
const statusResponse=(status,headers={})=>new Response(null,{status,headers});
test('acceptance plan has exactly the independently specified 18 method/path pairs',()=>{
  const expected=[...names.map(p=>'GET /'+p),...discovery.flatMap(p=>['GET','HEAD'].map(m=>m+' /.well-known/'+p)),'GET /api/brain/control'];
  assert.deepEqual(plan.map(label).sort(),expected.sort());
  assert.equal(new Set(plan.map(label)).size,18);
});

// Fault localization: inject a single fault at each possible progress position.
// A failure must stop the sequence, preserve preceding successes and never claim release proof.
const faults=[
  ['network TypeError',()=>{throw new TypeError('fixture network failure');},held('transport-unavailable')],
  ['request abort',()=>{throw new DOMException('fixture abort','AbortError');},held('transport-unavailable')],
  ['request timeout',()=>{throw new DOMException('fixture timeout','TimeoutError');},held('transport-unavailable')],
  ['quota exhaustion',()=>statusResponse(429,{'retry-after':'120'}),held('remote-hold-429')],
  ['origin unavailable',()=>statusResponse(503),held('remote-hold-503')],
  ['gateway timeout',()=>statusResponse(504),held('remote-hold-504')],
  ['moved permanently',()=>statusResponse(301,{location:'https://example.invalid/never-follow'}),failed],
  ['temporary redirect',()=>statusResponse(307,{location:'https://example.invalid/never-follow'}),failed],
  ['bad request',()=>statusResponse(400),failed],
  ['method not allowed',()=>statusResponse(405),failed],
  ['conflict',()=>statusResponse(409),failed],
];
for(const [i,item] of plan.entries()){
  for(const [fault,make,expected] of faults){
    test('fault localization: '+label(item)+' / '+fault,async()=>{
      const result=await probeAt(i,make,expected);
      if(fault==='quota exhaustion')assert.equal(result.checks.at(-1).headers['retry-after'],'120');
    });
  }
}

// Independently change one property of each curated document, preserving the others.
for(const [i,item] of plan.entries()){
  if(item.kind!=='doc')continue;
  const correct=docs.get(item.path);
  const header={'content-type':mime(item.path)};
  const cases=[
    ['wrong media type',()=>new Response(correct,{headers:{'content-type':'application/octet-stream'}}),failed],
    ['missing media type',()=>new Response(correct),failed],
    ['trailing byte',()=>new Response(Buffer.concat([correct,Buffer.from('x')]),{headers:header}),failed],
    ['empty payload',()=>new Response(null,{headers:header}),failed],
    ['UTF-8 BOM added',()=>new Response(Buffer.concat([Buffer.from([239,187,191]),correct]),{headers:header}),failed],
    ['declared body too large',()=>new Response(correct,{headers:{...header,'content-length':'16385'}}),held('body-limit')],
    ['streamed body exceeds limit',()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(8192));c.enqueue(new Uint8Array(8193));}}),{headers:header}),held('body-limit')],
    ['unexpected 404',()=>statusResponse(404),failed],
    ['unexpected 401',()=>statusResponse(401),held('remote-hold-401')],
    ['unexpected 403',()=>statusResponse(403),held('remote-hold-403')],
    ['no-content response',()=>statusResponse(204),failed],
  ];
  for(const [name,make,expected] of cases)test('document integrity: '+item.path+' / '+name,()=>probeAt(i,make,expected));
}

// Discovery response contracts: status, representation, cache and index policy are independent.
for(const [i,item] of plan.entries()){
  if(item.kind!=='unsupported')continue;
  const body=item.method==='HEAD'?null:'{"error":"not_found"}';
  const headers={'content-type':'application/json','cache-control':'no-store','x-robots-tag':'noindex, nofollow'};
  const response=(b=body,h=headers)=>new Response(b,{status:404,headers:h});
  const cases=[
    ['incorrect media type',()=>response(body,{...headers,'content-type':'text/html'}),failed],
    ['cacheable response',()=>response(body,{...headers,'cache-control':'public, max-age=3600'}),failed],
    ['indexable response',()=>response(body,{...headers,'x-robots-tag':'index, follow'}),failed],
    ['missing robots policy',()=>response(body,{'content-type':'application/json','cache-control':'no-store'}),failed],
    ['missing cache policy',()=>response(body,{'content-type':'application/json','x-robots-tag':'noindex'}),failed],
    ['incorrect body semantics',()=>response(item.method==='HEAD'?'unexpected':'{"error":"unsupported"}'),failed],
    ['false success',()=>statusResponse(200),failed],
    ['unexpected 401',()=>statusResponse(401),held('remote-hold-401')],
    ['unexpected 403',()=>statusResponse(403),held('remote-hold-403')],
  ];
  for(const [name,make,expected] of cases)test('discovery integrity: '+label(item)+' / '+name,()=>probeAt(i,make,expected));
}
const control=plan.findIndex(item=>item.kind==='protected');
for(const status of [200,201,202,204,404,410,422])test('protected endpoint rejects misleading '+status,()=>probeAt(control,()=>statusResponse(status),failed));

const invalid=[
  ['target missing',{target:undefined}],['target null',{target:null}],['target empty',{target:''}],
  ['arbitrary external target',{target:'https://example.invalid'}],['prototype target',{target:'__proto__'}],['case mismatch',{target:'EDGE'}],
  ['budget missing',{budgetBytes:undefined}],['negative budget',{budgetBytes:-1}],['fractional budget',{budgetBytes:1.5}],
  ['string budget',{budgetBytes:'1500000'}],['NaN budget',{budgetBytes:NaN}],['infinite budget',{budgetBytes:Infinity}],
  ['over max budget',{budgetBytes:2000001}],['unsafe budget',{budgetBytes:Number.MAX_SAFE_INTEGER+1}],
  ['missing source',{sourceSha:undefined}],['empty source',{sourceSha:''}],['short source',{sourceSha:'a'.repeat(39)}],
  ['long source',{sourceSha:'a'.repeat(41)}],['nonhex source',{sourceSha:'g'.repeat(40)}],['uppercase source',{sourceSha:'A'.repeat(40)}],
  ['source whitespace',{sourceSha:'a'.repeat(39)+' '}],['missing deployment',{deployment:undefined}],['empty deployment',{deployment:''}],
  ['deployment path',{deployment:'a/b'}],['deployment whitespace',{deployment:'a b'}],['deployment newline',{deployment:'a\nb'}],
  ['deployment exceeds bound',{deployment:'a'.repeat(101)}],['deployment Unicode',{deployment:'release\u2603'}],
];
for(const [name,override] of invalid)test('admission denies '+name,async()=>{
  let calls=0;
  await assert.rejects(runAgentAcceptance({...base,...override,fetcher:()=>{calls++;throw Error('unexpected fixture call');}}),/invalid-probe-configuration/);
  assert.equal(calls,0);
});
for(const n of [0,1,65535,65536,budget-2,budget-1])test('insufficient reservation '+n+' causes zero calls',async()=>{
  let calls=0;
  const r=await runAgentAcceptance({...base,budgetBytes:n,fetcher:()=>{calls++;throw Error('unexpected');}});
  assert.equal(r.status,'held');assert.equal(r.reason,'insufficient-budget');assert.equal(r.reservedBytes,budget);assert.equal(r.requested,0);assert.equal(calls,0);
});
for(const target of ['origin','edge'])for(const denial of [401,403])test('positive fixture '+target+' with control denial '+denial,async()=>{
  const expectedHost=target==='origin'?'ultron-mw-cloud.hatchable.site':'ultron-edge-shield.mahoraga-mjw0123.workers.dev';
  let i=0;
  const result=await runAgentAcceptance({...base,target,fetcher:async(url,init)=>{
    assert.equal(new URL(url).hostname,expectedHost);
    const item=plan[i++];assert.equal(new URL(url).pathname,item.path);assert.equal(init.method,item.method);
    return item.kind==='protected'?statusResponse(denial):valid(item);
  }});
  assert.equal(i,18);assert.equal(result.status,'passed-http-contract');assert.equal(result.reservedBytes,budget);
  assert.ok(result.checks.every(c=>c.passed));assert.equal(result.deploymentIdentityVerified,false);assert.equal(result.providerMeterVerified,false);
});

// Normalization and non-interference: distinguish reserved encoding from unreserved encoding.
for(const name of discovery){
  const canonical='/.well-known/'+name;
  const encodedFirst='%'+name.charCodeAt(0).toString(16)+name.slice(1);
  const encodedLast=name.slice(0,-1)+'%'+name.charCodeAt(name.length-1).toString(16);
  for(const [variant,path] of [['encoded first','/.well-known/'+encodedFirst],['encoded last','/.well-known/'+encodedLast],['trailing slashes',canonical+'///'],['encoded directory','/.%77ell-known/'+name],['uppercase hex escape','/%2Ewell-known/'+name]]){
    for(const method of ['GET','HEAD','OPTIONS'])test('discovery normalization: '+name+' / '+variant+' / '+method,async()=>{
      const r=unsupportedDiscoveryResponse(path,method);
      assert.equal(r?.status,404);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');
      assert.equal(await r.text(),method==='HEAD'?'':'{"error":"not_found"}');
    });
  }
  for(const [variant,path] of [['reserved slash','/.well-known%2F'+name],['child',canonical+'/child'],['double encoded','/.well-known/%25'+encodedFirst.slice(1)],['case changed','/.well-known/'+name.toUpperCase()],['prefix',canonical+'-extra'],['malformed escape',canonical+'%zz']]){
    test('discovery non-interference: '+name+' / '+variant,()=>assert.equal(unsupportedDiscoveryResponse(path,'GET'),null));
  }
}
