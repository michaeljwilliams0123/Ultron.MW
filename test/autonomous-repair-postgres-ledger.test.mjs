import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPostgresAutonomousRepairLedger} from '../src/autonomous-repair-postgres-ledger.mjs';
import {createAutonomousRepairPlan} from '../src/autonomous-repair-loop.mjs';

const base='a'.repeat(40),updated='b'.repeat(40);
const moment=Date.parse('2026-11-09T20:00:00Z');
const plan=()=>createAutonomousRepairPlan({id:'repair-checkpoint-001',
 owner:'michaeljwilliams0123',repository:'Ultron-MW/Ultron.MW',
 branch:'ultron/repair-checkpoint-001',baseSha:base,
 objective:'Repair repository unit tests using exact-context changes',
 allowedPaths:['src/example.mjs'],maxAttempts:3,maxPaidCents:0,
 paidFallback:false,expiresAt:'2026-11-10T20:00:00Z'},moment);
function manifest(){return {objective:'Fix tests',baseSha:base,
 changes:[{path:'src/example.mjs',before:'old',after:'new'}]};}

test('real PGlite PostgreSQL schema preserves resumable intent and append-only transitions',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  const migration=readFileSync(new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',import.meta.url),'utf8');
  await db.exec(migration);
  const p=plan(),a=createPostgresAutonomousRepairLedger({db});
  const claimed=await a.claim(p);
  assert.equal(claimed.phase,'ready');assert.equal(claimed.headSha,base);
  const duplicate=await a.claim(p);
  assert.deepEqual(duplicate,claimed);
  const patch=manifest(),patchDigest=createHash('sha256').update(JSON.stringify(patch)).digest('hex');
  const reserved=await a.transition({id:p.id,fingerprint:p.fingerprint,from:'ready',
   to:'patch-dispatched',expectedVersion:0,changes:{attempt:1,manifest:patch,patchDigest}});
  assert.equal(reserved.phase,'patch-dispatched');assert.equal(reserved.attempt,1);
  const resumed=createPostgresAutonomousRepairLedger({db});
  assert.deepEqual(await resumed.read(p.id),reserved);
  assert.equal(await resumed.transition({id:p.id,fingerprint:p.fingerprint,
    from:'ready',to:'patch-dispatched',expectedVersion:0,
    changes:{attempt:1,manifest:patch,patchDigest}}),null);
  const applied=await resumed.transition({id:p.id,fingerprint:p.fingerprint,
    from:'patch-dispatched',to:'applied',expectedVersion:1,
    changes:{headSha:updated}});
  assert.equal(applied.headSha,updated);assert.equal(applied.version,2);
  const events=await db.query('SELECT version,from_phase,to_phase FROM brain_autonomous_repair_events ORDER BY version');
  assert.deepEqual(events.rows.map(x=>x.to_phase),['patch-dispatched','applied']);
  await assert.rejects(db.query("DELETE FROM brain_autonomous_repair_events"),/append-only/);
  await assert.rejects(db.query("UPDATE brain_autonomous_repairs SET phase='complete' WHERE repair_id=$1",[p.id]),/fence|transition/);
 }finally{await db.close();}
});
test('fails closed on invalid adapters and rejected transitions',async()=>{
 assert.throws(()=>createPostgresAutonomousRepairLedger({}),/PostgreSQL/);
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',import.meta.url),'utf8'));
  const a=createPostgresAutonomousRepairLedger({db}),p=plan();
  await a.claim(p);
  await assert.rejects(a.transition({id:p.id,fingerprint:p.fingerprint,from:'ready',
   to:'complete',expectedVersion:0}),/transition-invalid/);
  await assert.rejects(a.transition({id:p.id,fingerprint:p.fingerprint,
   from:'ready',to:'patch-dispatched',expectedVersion:0,
   changes:{attempt:1,manifest:manifest(),patchDigest:'not-a-digest'}}),/content-invalid/);
  await assert.rejects(a.claim({...p,fingerprint:'f'.repeat(64)}),/idempotency-conflict/);
  assert.equal((await a.read(p.id)).phase,'ready');
 }finally{await db.close();}
});


test('per-task retry limit survives PostgreSQL claim and feeds the owner status projection',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {normalizeRepairStatus}=await import('../cloud/hatchable/lib/autonomous-repair-status.js');
 const db=new PGlite();
 try{
  await db.exec(readFileSync(new URL('../cloud/hatchable/migrations/0039_autonomous_repair_checkpoints.sql',import.meta.url),'utf8'));
  const {schema,fingerprint,...source}=plan();
  const oneAttempt=createAutonomousRepairPlan({...source,maxAttempts:1},moment);
  const ledger=createPostgresAutonomousRepairLedger({db});
  const claimed=await ledger.claim(oneAttempt);
  assert.equal(claimed.maxAttempts,1);
  assert.equal((await ledger.read(oneAttempt.id)).maxAttempts,1);
  const status=normalizeRepairStatus(await ledger.read(oneAttempt.id));
  assert.equal(status.maxAttempts,1);
  await assert.rejects(ledger.claim({...oneAttempt,maxAttempts:0}),/claim-invalid/);
 }finally{await db.close();}
});
