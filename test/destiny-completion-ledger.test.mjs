import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {assessDestinyCanary,canonicalDestinyReceipt,DESTINY_RECEIPT_SCHEMA}
  from '../src/destiny-executor-attestation.mjs';
import {recordDestinyCompletion} from '../src/destiny-completion-ledger.mjs';
import {readFile} from 'node:fs/promises';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const NOW=Date.parse('2026-11-02T20:00:00.000Z');
const intent=()=>({
  repository:'michaeljwilliams0123/Ultron.MW',
  taskId:'ucc-canary-000000000001',deliveryId:'continuum-destiny-0001',
  requestSha:'a'.repeat(64),sourceSha:'b'.repeat(40),
  routeSha:'c'.repeat(64),effect:'read',maxPaidCents:0,
});
const trust=()=>({state:'configured',executionLane:'codex-cloud',
  githubActor:'michaeljwilliams0123',environmentFingerprint:'e'.repeat(64),
  keyId:'destiny-executor-k1',publicKeyPem:publicKey.export({type:'spki',format:'pem'})});
const receipt=()=>({
  schema:DESTINY_RECEIPT_SCHEMA,repository:intent().repository,
  taskId:intent().taskId,deliveryId:intent().deliveryId,
  requestSha:intent().requestSha,sourceSha:intent().sourceSha,
  routeSha:intent().routeSha,authorId:'destiny-codex',executionLane:'codex-cloud',
  githubActor:'michaeljwilliams0123',environmentFingerprint:'e'.repeat(64),
  keyId:'destiny-executor-k1',effect:'read',maxPaidCents:0,status:'completed',
  resultSha:'d'.repeat(64),issuedAt:'2026-11-02T19:59:00.000Z',
  expiresAt:'2026-11-02T20:01:00.000Z',
});
const wire=(r=receipt())=>sign(null,Buffer.from(canonicalDestinyReceipt(r)),privateKey).toString('base64');
function dbFixture({route=true,throwAfterInsert=false,unreadable=false}={}){
  const rows=new Map(),sql=[],counts={inserts:0,reads:0};
  const db={async query(query,params=[]){
    sql.push({query,params});
    if(query.includes('INSERT INTO brain_destiny_completions')){
      counts.inserts++;
      assert.match(query,/JOIN brain_continuum_routes/);
      assert.match(query,/r\.source='destiny-codex-cloud'/);
      assert.match(query,/o\.objective_id=\$2/);
      assert.match(query,/o\.effect='read'/);
      assert.match(query,/ON CONFLICT DO NOTHING/);
      const [deliveryId,taskId,sourceSha,requestSha,routeSha,receiptSha,canonical,
        signature,actor,environment,keyId,resultSha]=params;
      const admitted=route&&taskId===intent().taskId&&
        deliveryId===intent().deliveryId&&sourceSha===intent().sourceSha&&
        requestSha===intent().requestSha&&routeSha===intent().routeSha;
      if(!admitted)return {rows:[]};
      if(!rows.has(deliveryId))
        rows.set(deliveryId,{deliveryId,taskId,sourceSha,requestSha,routeSha,
          receiptSha,canonical,signature,actor,environment,keyId,resultSha});
      const created=rows.size===1&&counts.inserts===1;
      if(throwAfterInsert)throw Error('socket reset after committed insert');
      return {rows:created?[{deliveryId,receiptSha}]:[]};
    }
    if(query.includes('FROM brain_destiny_completions')){
      counts.reads++;
      if(unreadable)throw Error('database read unavailable');
      const row=rows.get(params[0]);return {rows:row?[{...row}]:[]};
    }
    throw Error('unexpected query');
  }};
  return {db,rows,counts,sql};
}
const args=(db,values={})=>{
  const r=values.receipt??receipt();
  return {db,intent:intent(),receipt:r,signature:wire(r),trust:trust(),
    observedGitHubActor:'michaeljwilliams0123',now:NOW,...values};
};

test('RED: valid signed read-only result is stored once against immutable C01 route',async()=>{
  const f=dbFixture();
  const result=await recordDestinyCompletion(args(f.db));
  assert.equal(result.recorded,true);
  assert.equal(result.created,true);
  assert.equal(result.workAccountAuthenticated,false);
  assert.equal(result.productionAccepted,false);
  assert.match(result.receiptSha,/^[a-f0-9]{64}$/);
  const again=await recordDestinyCompletion(args(f.db));
  assert.equal(again.recorded,true);
  assert.equal(again.created,false);
  assert.equal(f.rows.size,1);
});

test('RED: signature, key, role, source, cost and forged actor fail before SQL',async()=>{
  for(const values of [
    {trust:{...trust(),state:'unconfigured'}},
    {trust:{...trust(),environmentFingerprint:'f'.repeat(64)}},
    {receipt:{...receipt(),effect:'write'}},
    {receipt:{...receipt(),maxPaidCents:2}},
    {intent:{...intent(),routeSha:'f'.repeat(64)}},
    {observedGitHubActor:'fake-actor'},
    {signature:'not-signed'},
  ]){
    const f=dbFixture();
    await assert.rejects(recordDestinyCompletion(args(f.db,values)),
      /destiny-completion-(?:blocked|reconcile)/);
    assert.equal(f.sql.length,0,'no query should follow an untrusted receipt');
  }
});

test('RED: missing independently authorized route cannot store a completion',async()=>{
  const f=dbFixture({route:false});
  await assert.rejects(recordDestinyCompletion(args(f.db)),/route-unadmitted/);
  assert.equal(f.rows.size,0);
});

test('RED: lost insert acknowledgment reconciles by SELECT once without re-execution',async()=>{
  const f=dbFixture({throwAfterInsert:true});
  const result=await recordDestinyCompletion(args(f.db));
  assert.equal(result.recorded,true);
  assert.equal(result.created,false);
  assert.equal(result.reconciled,true);
  assert.equal(f.counts.inserts,1);
  assert.equal(f.counts.reads,1);
});

test('RED: unknown write and failed readback fail closed',async()=>{
  const f=dbFixture({unreadable:true});
  await assert.rejects(recordDestinyCompletion(args(f.db)),/write-uncertain/);
  assert.equal(f.counts.inserts,1);
  assert.equal(f.counts.reads,1);
});

test('RED: same delivery with another signed result must be held as conflicting',async()=>{
  const f=dbFixture();await recordDestinyCompletion(args(f.db));
  const changed={...receipt(),resultSha:'f'.repeat(64)};
  await assert.rejects(recordDestinyCompletion(args(f.db,{receipt:changed})),/conflict/);
  assert.equal(f.rows.size,1);
});

test('RED: getters cannot swap signed identity after validation before persistence',async()=>{
  const f=dbFixture(),item=intent();
  let reads=0;
  Object.defineProperty(item,'sourceSha',{enumerable:true,
    get(){return ++reads===1?intent().sourceSha:'f'.repeat(40)}});
  await assert.rejects(recordDestinyCompletion(args(f.db,{intent:item})),/blocked/);
  assert.equal(f.sql.length,0);
});

test('RED: migration supports only pinned cloud route and immutable results',async()=>{
  const migration=await readFile(new URL('../cloud/hatchable/migrations/0015_destiny_completions.sql',import.meta.url),'utf8');
  assert.match(migration,/destiny-codex-cloud/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS brain_destiny_completions/);
  assert.match(migration,/delivery_id text NOT NULL PRIMARY KEY/);
  assert.match(migration,/BEFORE UPDATE OR DELETE ON brain_destiny_completions/);
  assert.match(migration,/CHECK \(status = 'signed-executor-receipt'\)/);
});
