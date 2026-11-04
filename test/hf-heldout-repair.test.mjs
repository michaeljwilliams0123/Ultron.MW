import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {HELDOUT_REPAIR_CASES,heldoutCorpusDigest} from '../src/hf-heldout-cases.mjs';
import {scoreProposedRepair,heldoutShard,makeHeldoutReceipt,admitHeldoutCpu}
 from '../src/hf-heldout-eval.mjs';

const sourceSha='a'.repeat(40), modelRevision='b'.repeat(40);
test('HF-HO-01: 16 immutable multi-line substantive repairs and independent reference vectors',()=>{
 assert.equal(HELDOUT_REPAIR_CASES.length,16);
 assert.equal(new Set(HELDOUT_REPAIR_CASES.map(x=>x.id)).size,16);
 assert.match(heldoutCorpusDigest(),/^[a-f0-9]{64}$/);
 for(const c of HELDOUT_REPAIR_CASES){
  assert.ok(c.broken.split('\n').length>=4,c.id);
  assert.ok(c.reference.split('\n').length>=4,c.id);
  assert.ok(c.goal.length>25,c.id);
  assert.ok(c.vectors.length>=3,c.id);
  assert.equal(scoreProposedRepair(c,c.reference).passed,true,c.id);
  assert.equal(scoreProposedRepair(c,c.broken).passed,false,c.id+' must reproduce a bug');
  assert.ok(Object.isFrozen(c));
 }
});
test('HF-HO-02: shards disjoint and exhaustive',()=>{
 const first=heldoutShard(0),second=heldoutShard(1);
 assert.equal(first.length,8);assert.equal(second.length,8);
 assert.equal(new Set([...first,...second].map(x=>x.id)).size,16);
 assert.deepEqual([...first,...second].map(x=>x.id).sort(),
  HELDOUT_REPAIR_CASES.map(x=>x.id).sort());
 assert.throws(()=>heldoutShard(2),/invalid-heldout-shard/);
});
test('HF-HO-03: rejects unsafe code, unscoped functions, and wrappers',()=>{
 const item=HELDOUT_REPAIR_CASES[0];
 for(const x of ['while(true){}','function fix(input) { return process.env.SECRET; }',
  'function fix(input) { fetch("https://example.com"); return true; }',
  'function fix(input) { return input.constructor.constructor("return process")(); }',
  'function fix(input) { for(;;){} }','function other(input) { return true; }',
  'function fix(input) { return require("fs"); }']){
  const out=scoreProposedRepair(item,x);
  assert.equal(out.passed,false,x);assert.equal(out.correctVectors,0,x);
  assert.ok(['unsafe-proposal','invalid-function','syntax-error'].includes(out.reason),x);
 }
});
test('HF-HO-04: independent behavior vectors distinguish broken from corrected',()=>{
 const item=HELDOUT_REPAIR_CASES[0];
 const good=scoreProposedRepair(item,item.reference);
 const broken=scoreProposedRepair(item,item.broken);
 assert.equal(good.passed,true);assert.equal(good.correctVectors,good.vectorCount);
 assert.equal(broken.passed,false);assert.ok(broken.correctVectors<broken.vectorCount);
 assert.equal(broken.reason,'behavior-mismatch');
});
test('HF-HO-05: refuse paid/GPU/private/unbounded runners',()=>{
 const good={repository:'michaeljwilliams0123/Ultron.MW',isPublic:true,
  runner:'ubuntu-24.04',parallel:4,gpu:false,costCents:0,shards:2};
 const plan=admitHeldoutCpu(good);
 assert.equal(plan.totalModelJobs,8);assert.equal(plan.maxParallel,4);
 assert.equal(plan.paidBudgetCents,0);
 for(const part of [{isPublic:false},{gpu:true},{costCents:1},
  {runner:'ubuntu-24.04-gpu'},{parallel:8},{repository:'other/repo'},
  {shards:3},{costCents:0.1}])
  assert.throws(()=>admitHeldoutCpu({...good,...part}),/heldout-cpu-admission-denied/);
});
test('HF-HO-06: receipt pins exact model, corpus and source',()=>{
 const rows=heldoutShard(0).map(c=>scoreProposedRepair(c,c.reference));
 const input={profile:'coder-small',revision:modelRevision,sourceSha,shard:0,
  paidCents:0,durationMs:1000,cases:rows};
 const receipt=makeHeldoutReceipt(input);
 assert.equal(receipt.schema,'ultron.hf.heldout-repair.v1');
 assert.equal(receipt.corpusDigest,heldoutCorpusDigest());
 assert.equal(receipt.passed,8);assert.equal(receipt.caseCount,8);
 assert.equal(receipt.paidCents,0);
 assert.equal(makeHeldoutReceipt(input).digest,receipt.digest);
 assert.match(receipt.digest,/^[a-f0-9]{64}$/);
 for(const tamper of [{sourceSha:'main'},{revision:'main'},{paidCents:1},
  {cases:rows.slice(0,7)},{cases:[...rows.slice(0,7),rows[0]]}])
  assert.throws(()=>makeHeldoutReceipt({...input,...tamper}),/invalid-heldout-receipt/);
});
test('HF-HO-07: manual matrix no secrets or paid GPU',async()=>{
 const yml=await readFile(new URL('../.github/workflows/hf-heldout-cpu.yml',import.meta.url),'utf8');
 assert.match(yml,/workflow_dispatch:/);assert.doesNotMatch(yml,/^\s+schedule:/m);
 assert.match(yml,/max-parallel:\s*4/);assert.match(yml,/runs-on:\s*ubuntu-24\.04/);
 assert.match(yml,/github\.event\.repository\.private == false/);
 assert.match(yml,/node scripts\/hf-heldout-cpu\.mjs/);
 assert.match(yml,/contents:\s*read/);
 assert.doesNotMatch(yml,/secrets\.|gpu-[^\s]+|HUGGING_FACE_TOKEN|HF_TOKEN/i);
});


test('HF-HO-08: larger candidate expands bounded matrix to eight jobs on four public runners',async()=>{
 const plan=admitHeldoutCpu({repository:'michaeljwilliams0123/Ultron.MW',isPublic:true,
  runner:'ubuntu-24.04',parallel:4,gpu:false,costCents:0,shards:2});
 assert.equal(plan.totalModelJobs,8);
 const yml=await readFile(new URL('../.github/workflows/hf-heldout-cpu.yml',import.meta.url),'utf8');
 assert.ok(yml.includes('profile: [baseline, coder-small, coder-medium, coder-large]'));
 assert.ok(yml.includes('max-parallel: 4'));
});
