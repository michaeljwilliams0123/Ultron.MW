import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {admitC06, evaluateC06Function, buildC06Artifacts, verifyC06Files,
  C06_CASES, C06_PATHS} from '../src/c06-model-origin.mjs';

const sha='a'.repeat(40);
const allowed={repository:'michaeljwilliams0123/Ultron.MW',actor:'michaeljwilliams0123',
 publicRepository:true,paidBudgetCents:0,sourceSha:sha,issueNumber:245,runner:'ubuntu-24.04'};
const functionSource=`function fix(input) {
 if (input?.providerStatus === 'unknown' || input?.providerStatus === 'timeout') return 'reconcile';
 if (input?.providerStatus === 'observed' && input?.receiptVerified === true) return 'verified';
 return 'held';
}`;
const tests=JSON.stringify([
 {input:{authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'verified'},
 {input:{authorized:true,paused:false,paidCents:0,providerStatus:'unknown',receiptVerified:false},expected:'reconcile'},
 {input:{authorized:true,paused:false,paidCents:0,providerStatus:'timeout',receiptVerified:true},expected:'reconcile'},
 {input:{authorized:true,paused:true,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'},
 {input:{authorized:false,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'},
 {input:{authorized:true,paused:false,paidCents:1,providerStatus:'observed',receiptVerified:true},expected:'held'}
]);
const docs='# C06 model-authored provider contract\n\nThe owner-only guard requires `authorized` true, `paused` false, and integer `paidCents` zero. Unknown provider outcomes reconcile: `providerStatus` unknown or timeout produces reconcile. An observed provider status with `receiptVerified` true produces verified. Every other request is held, including a paused request, an unauthorized owner, and paid spending. Independent tests and protected PR merge are mandatory. The model cannot change the fixed guard; production acceptance requires external receipt readback.';

test('C06-01 owner/public/free CPU/source pin admission is mandatory',()=>{
 const value=admitC06(allowed);
 assert.equal(value.model,'onnx-community/Qwen2.5-Coder-1.5B-Instruct');
 assert.equal(value.revision,'774cc908b6c2be23bc4e8d4e401e4f8b8fba7daf');
 assert.equal(value.paidBudgetCents,0);
 for(const item of [{actor:'attacker'},{repository:'other/repo'},{publicRepository:false},
  {paidBudgetCents:1},{paidBudgetCents:-1},{sourceSha:'main'},{issueNumber:244},
  {runner:'ubuntu-latest-gpu'}])
  assert.throws(()=>admitC06({...allowed,...item}),/c06-admission-denied/);
});

test('C06-02 independently scored code must implement all owner/stop/spend/unknown-write cases',()=>{
 assert.ok(C06_CASES.length>=12);
 const good=evaluateC06Function(functionSource);
 assert.equal(good.passed,true);
 assert.equal(good.correct,good.total);
 for(const unsafe of [
  'function fix(input) { return "verified"; }',
  'function fix(input) { return process.env.TOKEN; }',
  'function fix(input) { return input.constructor.constructor("return process")(); }',
  'function fix(input) { while(true) {} }',
  'function fix(input) { return "verified"; }\nprocess.exit(0);',
  'function fix(input) { return true; }\nfunction fix(input) { return true; }'
 ]){
  assert.equal(evaluateC06Function(unsafe).passed,false,unsafe);
 }
});

test('C06-03 only model-produced 3-file artifacts pass strict provenance and semantic checks',async()=>{
 const responses={source:functionSource,cases:tests,docs};
 const asked=[];
 const result=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12345',
  infer:async(kind,messages,attempt)=>{
   asked.push({kind,attempt,messages});
   return responses[kind];
  }
 });
 assert.deepEqual(asked.map(x=>x.kind),['source','cases','docs']);
 assert.ok(Object.keys(result.files).includes(C06_PATHS.source));
 assert.ok(Object.keys(result.files).includes(C06_PATHS.tests));
 assert.ok(Object.keys(result.files).includes(C06_PATHS.docs));
 assert.ok(Object.keys(result.files).includes(C06_PATHS.evidence));
 assert.equal(result.receipt.origin,'model-inference-not-assistant-authored');
 assert.equal(result.receipt.productionAccepted,false);
 assert.equal(result.receipt.modelRevision,admitC06(allowed).revision);
 assert.equal(verifyC06Files(result.files,{sourceSha:sha,runId:'12345'}).valid,true);
 assert.match(result.files[C06_PATHS.source],/export function classifyC06Effect\(input\)/);
 assert.match(result.files[C06_PATHS.tests],/generated/);
 assert.match(result.files[C06_PATHS.docs],/Unknown provider outcomes reconcile/);
});

test('C06-04 refuse generated test vectors that are vacuous or incorrect',async()=>{
 for(const bad of ['[]','{}','[{"expected":"verified"}]',JSON.stringify([
   {input:{authorized:false},expected:'verified'}])]){
   await assert.rejects(()=>buildC06Artifacts({
    admission:admitC06(allowed),runId:'12345',maxAttempts:1,
    infer:async kind=>({source:functionSource,cases:bad,docs})[kind]
   }),/c06-model-(?:cases|output)-rejected/);
 }
});

test('C06-05 fail closed on fake provenance, changed bytes or manipulated main SHA',async()=>{
 const result=await buildC06Artifacts({admission:admitC06(allowed),runId:'12345',
  infer:async kind=>({source:functionSource,cases:tests,docs})[kind]});
 for(const [path,value] of [
  [C06_PATHS.source,'export function fix(){return "verified";}'],
  [C06_PATHS.docs,'fake'],
  [C06_PATHS.evidence,'{}']
 ]) assert.throws(()=>verifyC06Files({...result.files,[path]:value},
   {sourceSha:sha,runId:'12345'}),/c06-provenance-invalid/);
 assert.throws(()=>verifyC06Files(result.files,{sourceSha:'b'.repeat(40),
  runId:'12345'}),/c06-provenance-invalid/);
});

test('C06-06 no deterministic substitution may rescue failed model output',async()=>{
 await assert.rejects(()=>buildC06Artifacts({
  admission:admitC06(allowed),runId:'12345',maxAttempts:2,
  infer:async kind=>kind==='source'?'function fix(input) { return "verified"; }':
   kind==='cases'?tests:docs,
 }),/c06-model-source-rejected/);
});

test('C06-07 workflow separates read-only inference from write-capable publishing',async()=>{
 const file=await readFile(new URL('../.github/workflows/c06-owner-model-release.yml',import.meta.url),'utf8');
 assert.match(file,/workflow_dispatch:/);
 assert.match(file,/runs-on:\s*ubuntu-24\.04/);
 assert.match(file,/node scripts\/c06-run-model\.mjs/);
 assert.match(file,/node scripts\/c06-verify-output\.mjs/);
 assert.match(file,/needs:\s*generate/);
 assert.match(file,/permissions:\s*\n\s*contents:\s*read/);
 assert.match(file,/pull-requests:\s*write/);
 assert.doesNotMatch(file,/^\s+schedule:/m);
 assert.doesNotMatch(file,/OPENAI_API_KEY|HF_TOKEN|jobs\.huggingface|gpu-/i);
});

test('C06-08 published verifier must not execute untrusted source under write token',async()=>{
 const file=await readFile(new URL('../scripts/c06-verify-output.mjs',import.meta.url),'utf8');
 assert.match(file,/verifyC06Files/);
 assert.doesNotMatch(file,/import\s*\(.*c06-model-candidate|vm\.run|execSync\(/);
});

test('C06-09 retry receives real previous model code and exact failed cases',async()=>{
 const broken=`function fix(input) {
 if (input?.providerStatus === 'observed') return 'verified';
 if (input?.providerStatus === 'unknown') return 'reconcile';
 return 'held';
}`;
 let count=0;
 const artifacts=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12345',maxAttempts:2,
  infer:async(kind,messages,attempt)=>{
   if(kind==='source'){
    count++;
    if(attempt===1)return broken;
    assert.match(messages[1].content,/Previous candidate/);
    assert.ok(messages[1].content.includes('providerStatus'));
    assert.ok(messages[1].content.includes('no-receipt'));
    assert.ok(messages[1].content.includes('expected held'));
    return functionSource;
   }
   return kind==='cases'?tests:docs;
  }
 });
 assert.equal(count,2);
 assert.equal(artifacts.receipt.independentCorrect,C06_CASES.length);
});

test('C06-10 failed correction never invents a fixed model source',async()=>{
 let requested=0;
 await assert.rejects(()=>buildC06Artifacts({
  admission:admitC06(allowed),runId:'12345',maxAttempts:2,
  infer:async(kind)=>{requested++;return kind==='source'?
   'function fix(input) { return "verified"; }':kind==='cases'?tests:docs;}
 }),/c06-model-source-rejected/);
 assert.equal(requested,2);
});

test('C06-11 model cannot self-authorize owner, pause or spend outside the generated provider function',async()=>{
 const result=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12345',
  infer:async kind=>({source:functionSource,cases:tests,docs})[kind]
 });
 const content=result.files[C06_PATHS.source];
 assert.match(content,/function fix\(input\)/);
 assert.match(content,/export function classifyC06Effect\(input\)/);
 assert.match(content,/Number\.isInteger\(input\.paidCents\)/);
 assert.match(content,/input\.authorized !== true/);
 assert.match(content,/input\.paused !== false/);
 const module=await import('data:text/javascript,'+encodeURIComponent(content));
 for(const row of C06_CASES)
  assert.equal(module.classifyC06Effect(row.input),row.expected,row.id);
});

test('C06-12 provider-only model must fail held-out provider checks even if owner fence is deterministic',()=>{
 const falseModel=`function fix(input) {
 if (input?.providerStatus === 'observed') return 'verified';
 return 'held';
}`;
 const result=evaluateC06Function(falseModel);
 assert.equal(result.passed,false);
 assert.ok(result.failures.some(x=>x.id==='no-receipt'));
 assert.ok(result.failures.some(x=>x.id==='uncertain'));
});

test('C06-13 model generates seven independently checked test vectors when suite JSON is invalid',async()=>{
 const rows=[
  {input:{authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'verified'},
  {input:{authorized:true,paused:false,paidCents:0,providerStatus:'unknown',receiptVerified:false},expected:'reconcile'},
  {input:{authorized:true,paused:false,paidCents:0,providerStatus:'timeout',receiptVerified:false},expected:'reconcile'},
  {input:{authorized:true,paused:true,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'},
  {input:{authorized:false,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:true},expected:'held'},
  {input:{authorized:true,paused:false,paidCents:1,providerStatus:'observed',receiptVerified:true},expected:'held'},
  {input:{authorized:true,paused:false,paidCents:0,providerStatus:'observed',receiptVerified:false},expected:'held'}
 ];
 let called=[];
 const result=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'90210',
  infer:async(kind,messages)=>{
   called.push({kind,request:messages[1].content});
   if(kind==='source')return functionSource;
   if(kind==='cases')return 'not a JSON array';
   if(kind==='case'){
    const found=messages[1].content.match(/Scenario: ([a-z-]+)/);
    assert.ok(found);
    const ids=['observed-verified','unknown-reconcile','timeout-reconcile','paused-held',
      'unauthorized-held','paid-held','unverified-held'];
    return JSON.stringify(rows[ids.indexOf(found[1])]);
   }
   return docs;
  }
 });
 assert.equal(called.filter(x=>x.kind==='case').length,7);
 assert.equal(result.receipt.testVectorMode,'individually-model-generated');
 assert.equal(verifyC06Files(result.files,{sourceSha:sha,runId:'90210'}).valid,true);
 assert.match(result.files[C06_PATHS.tests],/providerStatus/);
 assert.equal(result.receipt.independentCorrect,15);
});

test('C06-14 invalid model-generated chunk never becomes a deterministic reference vector',async()=>{
 let attempted=0;
 await assert.rejects(()=>buildC06Artifacts({
  admission:admitC06(allowed),runId:'90210',maxAttempts:2,
  infer:async(kind,messages)=>{
   if(kind==='source')return functionSource;
   if(kind==='cases')return 'invalid';
   if(kind==='case'){attempted++;return JSON.stringify({
    input:{authorized:true,paused:true,paidCents:0,providerStatus:'observed',receiptVerified:true},
    expected:'verified'
   });}
   return docs;
  }
 }),/c06-model-cases-rejected/);
 assert.equal(attempted,2);
});

test('C06-15 whitespace-only model blank lines are normalized before bytes and receipt are frozen',async()=>{
 const noisyFunction=functionSource.replace(
  " return 'held';", "   \n \t \n return 'held';");
 const noisyDocs=docs.replace('The owner','  \nThe owner');
 assert.match(noisyFunction,/^[ \t]+$/m);
 assert.match(noisyDocs,/^[ \t]+$/m);
 const result=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12347',
  infer:async kind=>({source:noisyFunction,cases:tests,docs:noisyDocs})[kind]
 });
 for(const [path,value] of Object.entries(result.files))
  assert.doesNotMatch(value,/^[ \t]+$/m,path);
 assert.equal(result.receipt.origin,'model-inference-not-assistant-authored');
 assert.match(result.receipt.generatedRawHashes.source,/^[a-f0-9]{64}$/);
 assert.equal(verifyC06Files(result.files,{sourceSha:sha,runId:'12347'}).valid,true);
 const {classifyC06Effect}=await import('data:text/javascript,'+
  encodeURIComponent(result.files[C06_PATHS.source]));
 for(const row of C06_CASES)assert.equal(classifyC06Effect(row.input),row.expected,row.id);
});

test('C06-17 technical documentation rejects invented organizational approvals and incomplete output',async()=>{
 const invented=docs.replace(
  'The owner-only guard requires',
  'An owner application must be approved by a project manager. The owner-only guard requires');
 const invalid=[
  invented,
  docs.trimEnd().slice(0,-1),
  docs.replaceAll('receiptVerified','evidence'),
  docs.replaceAll('providerStatus','provider state'),
  docs.replaceAll('paidCents','paid limit')
 ];
 for(const candidate of invalid){
  await assert.rejects(()=>buildC06Artifacts({
   admission:admitC06(allowed),runId:'12349',maxAttempts:1,
   infer:async kind=>({source:functionSource,cases:tests,docs:candidate})[kind]
  }),/c06-model-docs-rejected/);
 }
});

test('C06-18 model may repair its own documentation using precise rejection evidence',async()=>{
 let docsCalls=0;
 const generated=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12349',maxAttempts:2,
  infer:async(kind,messages)=>{
   if(kind!=='docs')return kind==='source'?functionSource:tests;
   docsCalls++;
   if(docsCalls===1)return docs.replace('owner-only guard','project manager application');
   assert.match(messages[1].content,/invented|forbidden|organizational|process/i);
   return docs;
  }
 });
 assert.equal(docsCalls,2);
 assert.match(generated.files[C06_PATHS.docs],/receiptVerified/);
 assert.equal(verifyC06Files(generated.files,{sourceSha:sha,runId:'12349'}).valid,true);
});

test('C06-19 accept substantial truthful technical documentation and preserve its model-origin digest',async()=>{
 const extended=docs+'\n\n'+('Independently verify a real provider receipt before a protected PR merge. ').repeat(22);
 assert.ok(extended.length>1800 && extended.length<2800);
 const generated=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12350',maxAttempts:1,
  infer:async kind=>({source:functionSource,cases:tests,docs:extended})[kind]
 });
 assert.ok(generated.files[C06_PATHS.docs].includes('receiptVerified'));
 assert.equal(generated.receipt.productionAccepted,false);
 assert.equal(generated.receipt.independentCorrect,15);
 assert.equal(verifyC06Files(generated.files,{sourceSha:sha,runId:'12350'}).valid,true);
});

test('C06-20 oversized, terse and truncated technical runbooks remain held',async()=>{
 for(const bad of [
  docs + (' Protected provider receipt.').repeat(150),
  '# Too short. paid held owner.',
  docs.trimEnd().slice(0,-1)
 ]){
  await assert.rejects(()=>buildC06Artifacts({
   admission:admitC06(allowed),runId:'12351',maxAttempts:1,
   infer:async kind=>({source:functionSource,cases:tests,docs:bad})[kind]
  }),/c06-model-docs-rejected/);
 }
});

test('C06-21 real CPU documentation stage uses a bounded short-generation budget',async()=>{
 const model=await readFile(new URL('../scripts/c06-run-model.mjs',import.meta.url),'utf8');
 assert.match(model,/kind==='docs'\?320:/);
});

test('C06-22 independently validate three genuinely model-authored document sections',async()=>{
 const sections={
  'owner-gate':'The owner gate requires authorized true, paused false and integer paidCents zero. Otherwise the request remains held. The independent wrapper, not model text, controls authority.',
  'provider-outcome':'For providerStatus unknown or timeout, the outcome is reconcile. ProviderStatus observed with receiptVerified true is verified. Missing or unverified receipt results stay held.',
  'release-evidence':'A protected PR requires independent tests and external provider readback before promotion. Even a passing model canary is not a production release. Owner approval and zero paid inference remain mandatory.'
 };
 const calls=[];
 const result=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12352',maxAttempts:3,
  infer:async(kind,messages)=>{
   calls.push(kind);
   if(kind==='source')return functionSource;
   if(kind==='cases')return tests;
   if(kind==='docs')return '# Owner paid held.';
   if(kind==='doc-section'){
    const id=messages[1].content.match(/Section: ([a-z-]+)/)?.[1];
    assert.ok(id&&sections[id],'missing section identity');
    return sections[id];
   }
   throw Error('unexpected inference stage');
  }
 });
 assert.equal(calls.filter(x=>x==='docs').length,1);
 assert.equal(calls.filter(x=>x==='doc-section').length,3);
 assert.equal(result.receipt.docGenerationMode,'sectioned-model-generated');
 assert.match(result.receipt.generatedRawHashes.docs,/^[a-f0-9]{64}$/);
 for(const fragment of Object.values(sections))
  assert.ok(result.files[C06_PATHS.docs].includes(fragment));
 assert.equal(verifyC06Files(result.files,{sourceSha:sha,runId:'12352'}).valid,true);
});

test('C06-23 invalid model-authored sections do not receive assistant-authored replacements',async()=>{
 let calls=0;
 await assert.rejects(()=>buildC06Artifacts({
  admission:admitC06(allowed),runId:'12353',maxAttempts:3,
  infer:async kind=>{
   if(kind==='source')return functionSource;
   if(kind==='cases')return tests;
   if(kind==='docs')return '# Owner paid held.';
   if(kind==='doc-section'){calls++;return 'Everything is approved';}
   throw Error('invalid inference kind');
  }
 }),/c06-model-docs-rejected/);
 assert.equal(calls,2);
});

test('C06-24 documentary section inference keeps a bounded smaller CPU budget',async()=>{
 const generator=await readFile(new URL('../scripts/c06-run-model.mjs',import.meta.url),'utf8');
 assert.match(generator,/kind==='doc-section'\?150:/);
});


test('C06-25 accepts complete authentic 938-character owner-gate sections without relaxing semantic checks',async()=>{
 const ownerBase='The owner gate requires authorized true, paused false and integer paidCents zero. Otherwise the request remains held. ';
 const owner=ownerBase+('The independently owned guard always keeps unauthorized or paused execution held. ').repeat(10);
 assert.ok(owner.length>760&&owner.length<1200);
 const sections={
  'owner-gate':owner,
  'provider-outcome':'The providerStatus unknown or timeout state must reconcile. A verified result requires providerStatus observed and receiptVerified true. Otherwise it stays held.',
  'release-evidence':'A protected PR requires independent readback and exact source evidence. No paid compute is authorized. This model canary is not a production release.'
 };
 const generated=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12355',maxAttempts:3,
  infer:async(kind,messages)=>{
   if(kind==='source')return functionSource;
   if(kind==='cases')return tests;
   if(kind==='docs')return '# Invalid short document.';
   if(kind==='doc-section')return sections[messages[1].content.match(/Section: ([a-z-]+)/)?.[1]];
   throw Error('unexpected-generation-stage');
  }
 });
 assert.ok(generated.files[C06_PATHS.docs].includes(owner));
 assert.equal(generated.receipt.docGenerationMode,'sectioned-model-generated');
 assert.equal(verifyC06Files(generated.files,{sourceSha:sha,runId:'12355'}).valid,true);
});

test('C06-26 allows complete three-section technical docs above 2800 chars but rejects unbounded text',async()=>{
 const make=(base)=>base+(' Only independent evidence permits a protected outcome.').repeat(16);
 const sections={
  'owner-gate':make('The owner gate requires authorized true, paused false, integer paidCents zero, or remains held.'),
  'provider-outcome':make('A providerStatus unknown or timeout must reconcile. Only observed with receiptVerified true is verified. Other states remain held.'),
  'release-evidence':make('A protected PR needs independent external readback and no paid provider use. Do not approve production until verified.')
 };
 const full='# C06 model-generated technical contract\n\n'+Object.values(sections).join('\n\n');
 assert.ok(full.length>2800&&full.length<4000);
 const result=await buildC06Artifacts({
  admission:admitC06(allowed),runId:'12356',maxAttempts:3,
  infer:async(kind,messages)=>{
   if(kind==='source')return functionSource;
   if(kind==='cases')return tests;
   if(kind==='docs')return '# Short invalid text.';
   if(kind==='doc-section')return sections[messages[1].content.match(/Section: ([a-z-]+)/)?.[1]];
  }
 });
 assert.equal(verifyC06Files(result.files,{sourceSha:sha,runId:'12356'}).valid,true);
 assert.match(result.files[C06_PATHS.docs],/receiptVerified/);
 await assert.rejects(()=>buildC06Artifacts({
  admission:admitC06(allowed),runId:'12357',maxAttempts:1,
  infer:async kind=>({source:functionSource,cases:tests,
   docs:docs+'\n'+(' Excessively long untrusted narrative.').repeat(180)})[kind]
 }),/c06-model-docs-rejected/);
});
