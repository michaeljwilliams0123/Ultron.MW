import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {verifyUuamDelivery,persistUuamDelivery} from '../cloud/hatchable/lib/uuam-inbox.js';

let PGlite;
try{({PGlite}=await import('@electric-sql/pglite'));}catch{}
if(process.env.CI==='true'&&!PGlite)throw Error('UUAM receiver requires PGlite in CI');
const skip=PGlite?false:'@electric-sql/pglite unavailable';
const KEY='uuam-forwarder-test-secret-unique-'+ 'z'.repeat(24);
const te=new TextEncoder();
const DIGEST='a'.repeat(64);
const NONCE='b'.repeat(32);
const BODY={
  schema:'ultron.uuam.ingress.v1',
  source:'ultron-staging',
  deliveryId:'delivery-receiver-001',
  taskKey:'task-receiver-001',
  operationDigest:DIGEST,
  githubIdempotencyKey:'ultron-task-receiver-001',
  nonce:NONCE,
  payload:{objective:'read-only-staging-canary'}
};
const raw=body=>JSON.stringify(body);
const hex=u8=>Buffer.from(u8).toString('hex');
const sha=async str=>hex(await webcrypto.subtle.digest('SHA-256',te.encode(str)));
const received=async(body=BODY,params={})=>{
  const rawBody=raw(body),timestamp=String(Math.floor(Date.now()/1000));
  const wire={
    schema:'ultron.uuam.edge.v1',source:body.source,
    deliveryId:body.deliveryId,taskKey:body.taskKey,
    operationDigest:body.operationDigest,
    githubIdempotencyKey:body.githubIdempotencyKey,
    nonce:body.nonce,rawBody,rawSha256:await sha(rawBody),
    queuedAt:Date.now(),...params};
  const original=JSON.stringify(wire);
  const signingKey=await webcrypto.subtle.importKey('raw',te.encode(KEY),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=hex(await webcrypto.subtle.sign('HMAC',signingKey,
    te.encode(timestamp+'.'+original)));
  return {raw:original,timestamp,signature:'sha256='+sig,
    secret:KEY,subtle:webcrypto.subtle};
};
const verify=async wire=>verifyUuamDelivery({now:Date.now(),...wire});
const dbFixture=async()=>{
  const db=new PGlite();
  for(const name of ['0008_admin_grants.sql','0009_signed_event_inbox.sql',
    '0039_github_idempotent_executions.sql','0047_omni_state_machine.sql'])
    await db.exec(await readFile(new URL('../cloud/hatchable/migrations/'+name,
      import.meta.url),'utf8'));
  const driver={
    query:(sql,args)=>db.query(sql,args),
    async transaction(statements){
      await db.query('BEGIN');
      const results=[];
      try{
        for(const s of statements)results.push(await db.query(s.sql,s.params));
        await db.query('COMMIT');
        return {results};
      }catch(e){await db.query('ROLLBACK');throw e;}
    }
  };
  return {db,driver};
};

test('signed exact raw body is verified and yields no secret or owner permission',async()=>{
  const verified=await verify(await received());
  assert.equal(verified.deliveryId,BODY.deliveryId);
  assert.equal(verified.operationDigest,DIGEST);
  assert.equal(verified.nonce,NONCE);
  assert.equal('secret' in verified,false);
  assert.equal('authorized' in verified,false);
});
test('missing, forged, and stale HMAC deny before persistence',async()=>{
  const wire=await received();
  await assert.rejects(verify({...wire,signature:'sha256='+'0'.repeat(64)}),
    /signature/i);
  await assert.rejects(verify({...wire,secret:undefined}),/unconfigured/i);
  await assert.rejects(verify({...wire,now:Date.now()+301000}),/timestamp/i);
  await assert.rejects(verify({...wire,raw:wire.raw.replace('read-only','write')}),/signature/i);
});
test('tampered forwarding hash, identity, or nonce is rejected',async()=>{
  for(const patch of [{rawSha256:'0'.repeat(64)},{nonce:'d'.repeat(32)},
    {source:'evil'},{operationDigest:'c'.repeat(64)},
    {githubIdempotencyKey:'ultron-task-other'}]){
    const wire=await received(BODY,patch);
    await assert.rejects(verify(wire),/invalid|mismatch|digest/i);
  }
});
test('unsigned forged verified-looking object never reaches SQL',{skip},async()=>{
  const {db,driver}=await dbFixture();
  try{
    await assert.rejects(persistUuamDelivery({db:driver,
      delivery:{...BODY,verified:true}}),/unverified/i);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM brain_signed_inbox')).rows[0].n,0);
  }finally{await db.close();}
});
test('durable admission and duplicate replay retain one inbox and state row',{skip},async()=>{
  const {db,driver}=await dbFixture();
  try{
    const delivery=await verify(await received());
    const first=await persistUuamDelivery({db:driver,delivery});
    assert.equal(first.status,'persisted');
    assert.equal(first.deliveryId,BODY.deliveryId);
    assert.equal(first.payloadSha256,await sha(raw(BODY)));
    const second=await persistUuamDelivery({db:driver,delivery});
    assert.equal(second.status,'already_persisted');
    const row=(await db.query('SELECT count(*)::int AS inbox FROM brain_signed_inbox')).rows[0];
    const states=(await db.query('SELECT count(*)::int AS n FROM brain_omni_execution_state')).rows[0];
    assert.equal(row.inbox,1);
    assert.equal(states.n,1);
  }finally{await db.close();}
});
test('different delivery id with reused nonce cannot enter the projection',{skip},async()=>{
  const {db,driver}=await dbFixture();
  try{
    await persistUuamDelivery({db:driver,delivery:await verify(await received())});
    const second=await verify(await received({...BODY,
      deliveryId:'delivery-receiver-002',
      taskKey:'task-receiver-002',
      githubIdempotencyKey:'ultron-task-receiver-002'
    }));
    await assert.rejects(persistUuamDelivery({db:driver,delivery:second}),
      /conflict|nonce/i);
    // The surrounding PostgreSQL transaction must roll back BOTH inserts.
    assert.equal((await db.query('SELECT count(*)::int AS n FROM brain_signed_inbox')).rows[0].n,1);
  }finally{await db.close();}
});
test('same delivery identity with altered payload conflicts without overwrite',{skip},async()=>{
  const {db,driver}=await dbFixture();
  try{
    await persistUuamDelivery({db:driver,delivery:await verify(await received())});
    const changed=await verify(await received({...BODY,payload:{objective:'different'}}));
    await assert.rejects(persistUuamDelivery({db:driver,delivery:changed}),/conflict/i);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM brain_signed_inbox')).rows[0].n,1);
  }finally{await db.close();}
});
test('conflicting operation digest or GitHub key fails closed',{skip},async()=>{
  const {db,driver}=await dbFixture();
  try{
    await persistUuamDelivery({db:driver,delivery:await verify(await received())});
    for(const override of [{operationDigest:'e'.repeat(64)},
      {githubIdempotencyKey:'ultron-task-receiver-conflict'}]){
      const changed=await verify(await received({...BODY,...override}));
      await assert.rejects(persistUuamDelivery({db:driver,delivery:changed}),/conflict/i);
    }
  }finally{await db.close();}
});
test('readback failure cannot claim persistence after a committed insert',{skip},async()=>{
  const {db,driver}=await dbFixture();
  try{
    const realQuery=driver.query;
    driver.query=async()=>{throw Error('PostgreSQL readback connection reset');};
    const delivery=await verify(await received());
    await assert.rejects(persistUuamDelivery({db:driver,delivery}),/uncertain/i);
    driver.query=realQuery;
    assert.equal((await db.query('SELECT count(*)::int AS n FROM brain_signed_inbox')).rows[0].n,1);
    assert.equal((await persistUuamDelivery({db:driver,delivery})).status,'already_persisted');
  }finally{await db.close();}
});
test('missing 0047 schema rejects rather than accepting an orphan inbox record',{skip},async()=>{
  const db=new PGlite();
  try{
    await db.exec(await readFile(new URL('../cloud/hatchable/migrations/0009_signed_event_inbox.sql',import.meta.url),'utf8'));
    const driver={query:(sql,params)=>db.query(sql,params),async transaction(steps){
      await db.query('BEGIN');try{
        for(const s of steps)await db.query(s.sql,s.params);
        await db.query('COMMIT');return {results:[]};
      }catch(e){await db.query('ROLLBACK');throw e;}
    }};
    await assert.rejects(persistUuamDelivery({db:driver,
      delivery:await verify(await received())}),/unavailable|uncertain/i);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM brain_signed_inbox')).rows[0].n,0);
  }finally{await db.close();}
});
test('Hatchable route is public POST and requires signed raw body before DB',async()=>{
  const text=await readFile(new URL('../cloud/hatchable/api/brain/uuam-inbox.js',import.meta.url),'utf8');
  assert.match(text,/export const access\s*=\s*'public'/);
  assert.match(text,/export const methods\s*=\s*\['POST'\]/);
  assert.match(text,/req\.rawBody/);
  assert.match(text,/ULTRON_UUAM_DELIVERY_HMAC_KEY/);
  assert.match(text,/uuam_inbox_enabled/);
  assert.doesNotMatch(text,/staging-secret|DATABASE_URL|process\.env/);
});

test('receiver authenticates the exact HMAC when Hatchable supplies Uint8Array rawBody',async()=>{
 const wire=await received();
 const bytes=te.encode(wire.raw);
 const verified=await verify({...wire,raw:bytes});
 assert.equal(verified.deliveryId,BODY.deliveryId);
 assert.equal(verified.payloadSha256,await sha(raw(BODY)));
 await assert.rejects(verify({...wire,raw:new Uint8Array([0xc3,0x28])}),/invalid/i);
});
