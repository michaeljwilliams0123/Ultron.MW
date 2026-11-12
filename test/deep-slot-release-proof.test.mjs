import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {classifySlot,recordSlot,completeSlot,planRecovery,slotKey}
 from '../src/scheduler/slot-ledger.mjs';
import {buildReleaseProof} from '../src/evidence/release-proof.mjs';
const S='2026-11-11T21:00Z',HEAD='a'.repeat(40);
const roles=['architect','security','sre','qa','scope','devils_advocate','judge'];
const appIds=Object.fromEntries(roles.map((r,i)=>[r,i+1001]));
const runs=roles.map(r=>({name:'council/'+r,app:{id:appIds[r]},
 head_sha:HEAD,status:'completed',conclusion:'success'}));
const ci={verified:true,status:'verified',headSha:HEAD,workflowId:388875616,runId:43044028617};
const deployment={target:'hatchable-v91',sourceSha:HEAD,
 artifactDigest:'sha256:'+'b'.repeat(64),receiptId:'pg-exec-919',independentReadback:true};
test('SLOT-01 canonical UTC key and :40 pickup misses :17 by 23 minutes',()=>{
 assert.equal(slotKey('2026-11-11T21:40:11Z'),S);
 const late=classifySlot({scheduledHour:S,actualPickupAt:'2026-11-11T21:40:00Z',
  declaredMinute:17,completionStatus:'done'});
 assert.equal(late.pickupLagSeconds,1380);assert.equal(late.sloBreach,true);
 assert.equal(late.primaryOnTime,false);
});
test('SLOT-02 :15 next hour is 58 minutes late, recovery not primary on-time',()=>{
 const after=classifySlot({scheduledHour:S,actualPickupAt:'2026-11-11T22:15:00Z',completionStatus:'done'});
 assert.equal(after.pickupLagSeconds,3480);assert.equal(after.sloBreach,true);
 const recovered=classifySlot({scheduledHour:S,actualPickupAt:'2026-11-11T21:20:00Z',
  completionStatus:'done',recovery:true});
 assert.equal(recovered.primaryOnTime,false);
});
test('SLOT-03 concurrent duplicate records preserve first slot classification',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE brain_authority_grants(grant_id TEXT PRIMARY KEY)');
 await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0045_deep_mutation_and_slots.sql',import.meta.url),'utf8'));
 const primary=classifySlot({scheduledHour:S,actualPickupAt:'2026-11-11T21:17:30Z'});
 const recovery=classifySlot({scheduledHour:S,actualPickupAt:'2026-11-11T22:40:00Z',recovery:true});
 const [a,b]=await Promise.all([recordSlot({db,slot:primary}),recordSlot({db,slot:recovery})]);
 assert.equal([a.created,b.created].filter(Boolean).length,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM brain_scheduler_slots')).rows[0].n,1);
 assert.equal((await completeSlot({db,key:S,status:'done'})).updated,true);
 assert.equal((await completeSlot({db,key:S,status:'failed'})).updated,false);
});
test('SLOT-04 bounded backfill never includes current hour',()=>{
 assert.deepEqual(planRecovery({now:'2026-11-11T22:00:00Z',lookbackHours:2,existingKeys:[S]}),
 ['2026-11-11T20:00Z']);
});
test('RELEASE-01 all independent evidence agrees on exact SHA',async()=>{
 const result=await buildReleaseProof({commitSha:HEAD,ci,councilChecks:runs,expectedAppIds:appIds,deployment});
 assert.equal(result.status,'verified');assert.equal(result.council.quorum,'7/7');
 assert.equal(result.evidenceSha256.length,64);
});
test('RELEASE-02 outdated CI, shared role App, wrong deployed SHA downgrade',async()=>{
 const good={commitSha:HEAD,ci,councilChecks:runs,expectedAppIds:appIds,deployment};
 const stale=await buildReleaseProof({...good,ci:{...ci,headSha:'c'.repeat(40)}});
 assert.equal(stale.verified,false);
 const spoof=await buildReleaseProof({...good,expectedAppIds:{...appIds,judge:appIds.qa}});
 assert.equal(spoof.verified,false);
 const drift=await buildReleaseProof({...good,deployment:{...deployment,sourceSha:'d'.repeat(40)}});
 assert.equal(drift.status,'unverified-drift');
});
test('RELEASE-03 release envelope cannot claim verified without live artifact readback',async()=>{
 const x=await buildReleaseProof({commitSha:HEAD,ci,councilChecks:runs,expectedAppIds:appIds,
  deployment:{...deployment,independentReadback:false}});
 assert.equal(x.verified,false);
});
test('SLOT-05 Node and Hatchable classifier match byte-for-byte',()=>{
 assert.equal(readFileSync(new URL('../src/scheduler/slot-ledger.mjs',import.meta.url),'utf8'),
  readFileSync(new URL('../cloud/hatchable/lib/slot-ledger.js',import.meta.url),'utf8'));
});

test('SLOT-06 cloud tick records pickup and never marks queued work as done',()=>{
 const source=readFileSync(new URL('../cloud/hatchable/api/brain/tick.js',import.meta.url),'utf8');
 assert.match(source,/classifySlot\(/);
 assert.match(source,/recordSlot\(\{db,slot\}\)/);
 assert.match(source,/completionStatus:'pending'/);
 assert.match(source,/slot_evidence:slotEvidence/);
});
test('RELEASE-04 owner route exposes unknown release honestly',()=>{
 const source=readFileSync(new URL('../cloud/hatchable/api/brain/release-proof.js',import.meta.url),'utf8');
 assert.match(source,/access='admin'/);
 assert.match(source,/methods=\['GET'\]/);
 assert.match(source,/councilChecks:\[\],expectedAppIds:\{\},deployment:\{\}/);
});
test('RELEASE-05 source and Hatchable proof policies stay byte-identical',()=>{
 const node=readFileSync(new URL('../src/evidence/release-proof.mjs',import.meta.url),'utf8');
 const hatch=readFileSync(new URL('../cloud/hatchable/lib/release-proof.js',import.meta.url),'utf8');
 assert.equal(node,hatch);
});
