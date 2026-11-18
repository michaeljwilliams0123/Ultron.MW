import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresUniversalCloudOutbox} from
  '../cloud/hatchable/lib/universal-cloud-postgres.js';

const SHA='a'.repeat(64),KEY='cloud:gitlab:pg-test-001';
async function database({paused=false,maxPaidCents=0,profileVersion=3}={}){
  const db=new PGlite();
  await db.exec([
    "CREATE TABLE brain_owner_autonomy_profile(id smallint PRIMARY KEY,owner text,preset text,version bigint,max_paid_cents integer,allowed_operations jsonb)",
    "CREATE TABLE brain_runtime_control(id smallint PRIMARY KEY,paused boolean,version bigint)",
    "CREATE TABLE brain_tasks(id bigserial PRIMARY KEY,task_key text NOT NULL UNIQUE,objective text NOT NULL,status text NOT NULL,attempts integer,max_attempts integer,fencing_generation bigint,last_result jsonb,updated_at timestamptz DEFAULT now())"
  ].join(';')+';');
  await db.query("INSERT INTO brain_owner_autonomy_profile VALUES (1,'michaeljwilliams0123','build',$1,$2,$3::jsonb)",
    [profileVersion,maxPaidCents,JSON.stringify({'gitlab.branch.create':true})]);
  await db.query('INSERT INTO brain_runtime_control VALUES (1,$1,5)',[paused]);
  return db;
}
function outbox(db){
  return createPostgresUniversalCloudOutbox({
    db,operation:'gitlab.branch.create',profileVersion:3,stopVersion:5,
  });
}
test('PostgreSQL reserve/send/terminal receipt is atomic, persisted, and not replayable',async()=>{
  const db=await database();
  try{
    const store=outbox(db);
    const reserved=await store.reserve({idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:5});
    assert.equal(reserved.ok,true);
    assert.ok(Number.isSafeInteger(reserved.fencingEpoch));
    const replay=await store.reserve({idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:5});
    assert.equal(replay.ok,false);
    assert.equal(replay.existingStatus,'reserved');
    assert.equal((await store.markSent({
      idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:reserved.fencingEpoch,
    })).ok,true);
    const terminal=await store.markCompleted({
      idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:reserved.fencingEpoch,
      provider:'gitlab',operation:'gitlab.branch.create',externalId:'gl-1',
    });
    assert.equal(terminal.verified,true);
    assert.equal((await store.markSent({
      idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:reserved.fencingEpoch,
    })).ok,false);
    const persisted=await db.query('SELECT last_result,status FROM brain_tasks WHERE task_key=$1',
      ['cloud:universal:'+KEY]);
    assert.equal(persisted.rows[0].status,'external');
    assert.equal(persisted.rows[0].last_result.state,'completed');
  }finally{await db.close();}
});
test('policy pause and nonzero paid ceiling block admission before reservation',async()=>{
  for(const configuration of [{paused:true},{maxPaidCents:1},{profileVersion:2}]){
    const db=await database(configuration);
    try{
      const result=await outbox(db).reserve({
        idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:5,
      });
      assert.equal(result.ok,false);
      const rows=await db.query("SELECT count(*)::int AS n FROM brain_tasks");
      assert.equal(rows.rows[0].n,0);
    }finally{await db.close();}
  }
});
test('lost ACK is reconciled and cannot be submitted again with stale generation',async()=>{
  const db=await database();
  try{
    const store=outbox(db);
    const r=await store.reserve({idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:5});
    assert.equal(r.ok,true);
    assert.equal((await store.markSent({
      idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:r.fencingEpoch,
    })).ok,true);
    assert.equal((await store.markReconcile({
      idempotencyKey:KEY,fencingEpoch:r.fencingEpoch,reason:'provider-ack-unknown',
    })).ok,true);
    const duplicate=await store.reserve({idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:5});
    assert.equal(duplicate.existingStatus,'reconcile_required');
    assert.equal((await store.markSent({
      idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:r.fencingEpoch,
    })).ok,false);
    assert.equal((await store.markCompleted({
      idempotencyKey:KEY,requestDigest:SHA,fencingEpoch:r.fencingEpoch,
    })).verified,false);
  }finally{await db.close();}
});
