import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildAgentDocs,buildCrawlerPolicy} from '../scripts/build-agent-docs.mjs';
import {runAgentAcceptance,acceptancePlan,assertCleanSource} from '../scripts/agent-http-acceptance.mjs';
const docs={...buildAgentDocs(),'robots.txt':buildCrawlerPolicy()};
const options={target:'edge',budgetBytes:1500000,sourceSha:'a'.repeat(40),deployment:'test-fixture'};
function response(url,init){
  const p=new URL(url).pathname;
  if(p==='/api/brain/control')return new Response(null,{status:403});
  if(p.startsWith('/.well-known/'))return new Response(init.method==='HEAD'?null:'{"error":"not_found"}',{status:404,headers:{'content-type':'application/json','cache-control':'no-store','x-robots-tag':'noindex'}});
  const name=p.slice(1);
  return new Response(docs[name],{headers:{'content-type':name.endsWith('.md')?'text/markdown':name.endsWith('.xml')?'application/xml':name.endsWith('.html')?'text/html':'text/plain'}});
}
test('budget and exact target fail closed before network',async()=>{
 let calls=0;const fetcher=()=>{calls++;throw Error('unexpected');};
 const result=await runAgentAcceptance({...options,budgetBytes:0,fetcher});
 assert.equal(result.reason,'insufficient-budget');assert.equal(calls,0);
 await assert.rejects(runAgentAcceptance({...options,target:'https://elsewhere.invalid',fetcher}),/invalid-probe/);
 assert.equal(calls,0);
});
test('fixture verifies every approved response without claiming deployment or meter proof',async()=>{
 let calls=0;const result=await runAgentAcceptance({...options,fetcher:async(url,init)=>{
   calls++;assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.ok(!('authorization' in init.headers));
   return response(url,init);
 }});
 assert.equal(result.status,'passed-http-contract');assert.equal(calls,18);assert.equal(acceptancePlan().length,18);
 assert.equal(result.deploymentIdentityVerified,false);assert.equal(result.providerMeterVerified,false);
});
test('wrong MIME and HTML fallback fail closed without further probes',async()=>{
 let calls=0;const r=await runAgentAcceptance({...options,fetcher:async()=>{calls++;return new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}});}});
 assert.equal(r.status,'failed');assert.equal(calls,1);
});
test('redirects are not followed and 429 stops subsequent probes',async()=>{
 for(const status of [302,429,503,401,403]){
   let calls=0;const r=await runAgentAcceptance({...options,fetcher:async()=>{calls++;return new Response(null,{status,headers:{location:'https://elsewhere.invalid/'}});}});
   assert.equal(calls,1);assert.notEqual(r.status,'passed-http-contract');
 }
});
test('oversized streamed response cancels without reading later chunks',async()=>{
 let cancelled=false,calls=0;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;}});
 const r=await runAgentAcceptance({...options,fetcher:async()=>{calls++;return new Response(stream,{headers:{'content-type':'text/plain'}});}});
 assert.equal(r.reason,'body-limit');assert.equal(calls,1);assert.equal(cancelled,true);
});
test('exact bytes, unauthorized control and discovery headers are independently required',async()=>{
 for(const scenario of ['bytes','control','discovery']){
   const r=await runAgentAcceptance({...options,fetcher:async(url,init)=>{
     const p=new URL(url).pathname;
     if(scenario==='bytes'&&p==='/llms.txt')return new Response(docs['llms.txt']+'x',{headers:{'content-type':'text/plain'}});
     if(scenario==='control'&&p==='/api/brain/control')return new Response(null,{status:200});
     if(scenario==='discovery'&&p.startsWith('/.well-known/'))return new Response('{"error":"not_found"}',{status:404,headers:{'content-type':'application/json'}});
     return response(url,init);
   }});
   assert.equal(r.status,'failed',scenario);
 }
});

test('source identity rejects wrong SHA, modified tracked files and untracked content',()=>{
 const root=mkdtempSync(join(tmpdir(),'ultron-acceptance-checkout-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
   git('init','-q');writeFileSync(join(root,'fixture.txt'),'original');
   git('add','fixture.txt');git('-c','user.name=Test Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');
   const sha=git('rev-parse','HEAD');
   assert.equal(assertCleanSource(sha,root),sha);
   assert.throws(()=>assertCleanSource('0'.repeat(40),root),/source-mismatch/);
   writeFileSync(join(root,'fixture.txt'),'changed');
   assert.throws(()=>assertCleanSource(sha,root),/dirty-source/);
   git('restore','fixture.txt');
   writeFileSync(join(root,'untracked.txt'),'untracked');
   assert.throws(()=>assertCleanSource(sha,root),/dirty-source/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('evidence retains bounded selected headers without response secrets',async()=>{
 const r=await runAgentAcceptance({...options,fetcher:async(url,init)=>{
   const res=response(url,init);
   res.headers.set('vary','Accept');
   res.headers.set('set-cookie','fixture=not-for-evidence');
   res.headers.set('x-private','never-record');
   if(new URL(url).pathname==='/llms.txt')res.headers.set('cache-control','public, max-age=60');
   return res;
 }});
 assert.equal(r.status,'passed-http-contract');
 assert.equal(r.checks[0].headers['cache-control'],'public, max-age=60');
 assert.equal(r.checks[0].headers.vary,'Accept');
 assert.equal(r.checks.find(c=>c.path.startsWith('/.well-known/')).headers['x-robots-tag'],'noindex');
 assert.ok(!JSON.stringify(r).includes('not-for-evidence'));
 assert.ok(!JSON.stringify(r).includes('never-record'));
});
test('429 evidence records retry-after without probing another path',async()=>{
 let calls=0;
 const r=await runAgentAcceptance({...options,fetcher:async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'120'}});}});
 assert.equal(r.reason,'remote-hold-429');assert.equal(calls,1);
 assert.equal(r.checks[0].headers['retry-after'],'120');
});
