import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseWorkerRequest,runWorkerOperation,toLedgerResult,checkEgressUrl,WORKER_OPS} from '../src/council-worker.mjs';
import {createLedgerClient,runLedgeredAction} from '../src/council-ledger-client.mjs';
import {legacyView} from './workflow-lane-view.mjs';

const SHA='a'.repeat(40);
const base=over=>({objectiveId:'obj-1',op:'github.repo.inspect',sourceSha:SHA,...over});

test('requests are validated: allowlisted op, role, sha, size',()=>{
 assert.equal(parseWorkerRequest(base()).role,'Sentinel');
 for(const bad of [{op:'shell.exec'},{op:'file.write'},{objectiveId:'x'},{role:'Root'},{sourceSha:'abc'},
  {params:[1]},{params:{x:'y'.repeat(5000)}},{issueNumber:0}])
  assert.throws(()=>parseWorkerRequest(base(bad)));
 assert.equal(parseWorkerRequest(base()).caseDigest,parseWorkerRequest(base()).caseDigest);
 assert.notEqual(parseWorkerRequest(base()).caseDigest,parseWorkerRequest(base({objectiveId:'obj-2'})).caseDigest);
 // Only the controlled owner-OIDC browser write may have an external effect.
 assert.deepEqual(WORKER_OPS.filter(o=>/write|merge|delete|exec/.test(o)),
  ['browser.external-write']);
 assert.throws(()=>parseWorkerRequest(base({op:'browser.external-write',params:{
  url:'https://github.com/',marker:'unsafe'}})),/browser-write-/);
});

test('browser egress is SSRF-safe',()=>{
 for(const bad of ['http://example.com','https://localhost/','https://127.0.0.1/','https://10.0.0.1/',
  'https://169.254.169.254/latest','https://user:p@example.com/','https://example.com:8443/','https://evil.test/',
  'https://[::1]/','file:///etc/passwd','nonsense','https://metadata.internal/'])
  assert.throws(()=>checkEgressUrl(bad),/worker-/,bad);
 assert.equal(checkEgressUrl('https://example.com/a?b=1').hostname,'example.com');
 assert.throws(()=>parseWorkerRequest(base({op:'browser.check',params:{url:'https://evil.test/'}})),/allowlisted/);
});

test('repo.inspect verifies by double read; disagreement fails',async()=>{
 const req=parseWorkerRequest(base());
 const ok=await runWorkerOperation(req,{github:async p=>p.includes('/git/ref')?{object:{sha:SHA}}:{default_branch:'main',private:false}});
 assert.equal(ok.status,'verified');assert.equal(ok.modelInvoked,false);assert.equal(ok.independentReview,false);
 let n=0;
 const flip=await runWorkerOperation(req,{github:async p=>p.includes('/git/ref')?{object:{sha:(n++?'b':'a').repeat(40)}}:{default_branch:'main'}});
 assert.equal(flip.status,'failed');
});

test('ci.status is bound to the exact head and never green when incomplete',async()=>{
 const req=parseWorkerRequest(base({op:'github.ci.status'}));
 const mk=runs=>({github:async()=>({workflow_runs:runs})});
 const green=await runWorkerOperation(req,mk([{head_sha:SHA,name:'v',status:'completed',conclusion:'success'}]));
 assert.equal(green.status,'verified');assert.equal(green.observed.allGreen,true);
 const red=await runWorkerOperation(req,mk([{head_sha:SHA,status:'completed',conclusion:'failure'}]));
 assert.equal(red.observed.allGreen,false);
 const other=await runWorkerOperation(req,mk([{head_sha:'c'.repeat(40),status:'completed',conclusion:'success'}]));
 assert.equal(other.status,'failed');
 const pending=await runWorkerOperation(req,mk([{head_sha:SHA,status:'in_progress'}]));
 assert.equal(pending.status,'failed');
});

test('browser.check requires status and expected text; unconfigured is explicit',async()=>{
 const req=parseWorkerRequest(base({op:'browser.check',params:{url:'https://example.com/',expectText:'Example'}}));
 assert.equal((await runWorkerOperation(req,{})).status,'unconfigured');
 const page=(status,text)=>({browser:{check:async()=>({status,title:'t',text,screenshotSha256:'s'})}});
 assert.equal((await runWorkerOperation(req,page(200,'Example Domain'))).status,'verified');
 assert.equal((await runWorkerOperation(req,page(200,'nope'))).status,'failed');
 assert.equal((await runWorkerOperation(req,page(500,'Example'))).status,'failed');
});

test('mahoraga reads are unconfigured without an authorized repo/token',async()=>{
 const req=parseWorkerRequest(base({op:'mahoraga.repo.inspect'}));
 assert.equal((await runWorkerOperation(req,{})).status,'unconfigured');
 const r=await runWorkerOperation(req,{mahoragaRepo:'o/r',mahoragaGithub:async()=>({full_name:'o/r',default_branch:'main'})});
 assert.equal(r.status,'verified');
});

test('operations time out instead of hanging',async()=>{
 const req=parseWorkerRequest(base());
 const r=await runWorkerOperation(req,{github:()=>new Promise(()=>{})},{timeoutMs:30});
 assert.equal(r.status,'failed');assert.match(r.reason,/timeout/);
});

test('ledger mapping: only verified is done; worker is never an independent identity',async()=>{
 assert.equal(toLedgerResult({op:'x',objectiveId:'o',status:'verified'}).status,'done');
 assert.equal(toLedgerResult({op:'x',objectiveId:'o',status:'failed',reason:'r'}).status,'failed');
 assert.equal(toLedgerResult({op:'x',objectiveId:'o',status:'unconfigured'}).status,'unconfigured');
 // End-to-end with an in-memory ledger: duplicate dispatch of the same objective runs once.
 const rows=new Map();
 const ledger=createLedgerClient(async b=>{
  if(b.op==='reserve'){
   const key=b.role+b.operation+b.caseDigest+b.sourceSha+b.ordinal;
   if(!rows.has(key))rows.set(key,{key:'f'.repeat(64),state:'reserved'});
   return{status:200,body:{ok:true,record:{...rows.get(key)},k:key}};
  }
  const rec=[...rows.values()][0];
  if(rec.state!==b.from)return{status:409,body:{ok:false,error:'state-conflict',record:{...rec}}};
  rec.state=b.to;return{status:200,body:{ok:true,record:{...rec}}};
 });
 const req=parseWorkerRequest(base());let runs=0;
 const go=()=>runLedgeredAction({ledger,intent:{role:req.role,operation:req.op,caseDigest:req.caseDigest,sourceSha:SHA,ordinal:0},
  execute:async()=>{runs++;return toLedgerResult(await runWorkerOperation(req,{github:async p=>p.includes('/git/ref')?{object:{sha:SHA}}:{default_branch:'main'}}));}});
 assert.equal((await go()).ledgerState,'executed');
 assert.equal((await go()).skipped,true);
 assert.equal(runs,1);
});

test('worker workflow is owner-gated, main-only, bounded and SHA-pinned',()=>{
 const y=legacyView('council-worker.yml');
 assert.match(y,/github\.actor == 'michaeljwilliams0123'/);
 assert.match(y,/github\.ref == 'refs\/heads\/main'/);
 assert.match(y,/timeout-minutes: 5/);
 assert.match(y,/runs-on: ubuntu-24[.]04/);
 assert.match(y,/id-token: write/);
 assert.doesNotMatch(y,/pull_request_target|self-hosted|\$\{\{\s*github\.event\.[^}]*\}\}\s*$/m);
 for(const m of y.matchAll(/uses:\s*(\S+)@(\S+)/g))assert.match(m[2],/^[a-f0-9]{40}$/,m[1]);
});
