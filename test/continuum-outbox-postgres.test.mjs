// Ephemeral PostgreSQL integration only. Never connects to live Hatchable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';

const enabled=process.env.ULTRON_POSTGRES_TEST==='1';
const options={skip:!enabled,timeout:40_000};
const run=promisify(execFile);
let container;
if(enabled){
  const ids=execFileSync('docker',[
    'ps','--filter','ancestor=postgres:16-alpine','--format','{{.ID}}'
  ],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  assert.equal(ids.length,1,'exactly one disposable PostgreSQL CI service');
  container=ids[0];
}
test('C01 outbox enforces durable dedupe, immutable identity, zero cost and forward-only state in PostgreSQL',options,async t=>{
  const schema='ultron_c01_'+randomUUID().replaceAll('-','');
  async function sql(statement){
    const result=await run('docker',['exec',container,'psql','-U','ultron','-d','ultron',
      '-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',
      'SET search_path TO '+schema+'; '+statement],
      {timeout:10_000,maxBuffer:1024*1024});
    return result.stdout.trim();
  }
  await sql('CREATE SCHEMA '+schema);
  t.after(()=>sql('DROP SCHEMA '+schema+' CASCADE'));
  for(const name of ['0001_tasks.sql','0013_continuum_outbox.sql']){
    await sql(await readFile(new URL('../cloud/hatchable/migrations/'+name,import.meta.url),'utf8'));
  }
  await sql("INSERT INTO brain_tasks(task_key,objective) VALUES('c01-outbox-test','repo.inspect')");
  const insert=(override='')=>`INSERT INTO brain_continuum_outbox(
    task_id,objective_id,delivery_id,idempotency_key,repository,source_sha,
    authority_sha,request_sha,lease_generation,expires_at,effect,max_paid_cents)
    VALUES(1,'continuum-c01-objective-01','continuum-delivery-0001',
    'continuum:delivery:0001','michaeljwilliams0123/Ultron.MW',
    repeat('a',40),repeat('b',64),repeat('c',64),2,
    now()+interval '1 day','read',0)`+override;
  await sql(insert());
  assert.equal(await sql('SELECT count(*) FROM brain_continuum_outbox'),'1');
  await assert.rejects(sql(insert()),/duplicate key/);
  await assert.rejects(sql(`INSERT INTO brain_continuum_outbox(
    task_id,objective_id,delivery_id,idempotency_key,repository,source_sha,
    authority_sha,request_sha,lease_generation,expires_at,effect,max_paid_cents)
    VALUES(1,'continuum-c01-objective-02','continuum-delivery-0002',
    'continuum:delivery:0001','michaeljwilliams0123/Ultron.MW',
    repeat('a',40),repeat('b',64),repeat('c',64),2,
    now()+interval '1 day','read',0)`),/duplicate key/);
  await assert.rejects(sql(`INSERT INTO brain_continuum_outbox(
    task_id,objective_id,delivery_id,idempotency_key,repository,source_sha,
    authority_sha,request_sha,lease_generation,expires_at,effect,max_paid_cents)
    VALUES(1,'continuum-c01-objective-02','continuum-delivery-0002',
    'continuum:delivery:0002','michaeljwilliams0123/Ultron.MW',
    repeat('a',40),repeat('b',64),repeat('c',64),2,
    now()+interval '1 day','read',1)`),/check constraint/);
  await assert.rejects(sql(`UPDATE brain_continuum_outbox
    SET authority_sha=repeat('d',64) WHERE delivery_id='continuum-delivery-0001'`),
    /immutable identity/);
  await assert.rejects(sql(`UPDATE brain_continuum_outbox
    SET id=id+1000,state='reconcile-required'
    WHERE delivery_id='continuum-delivery-0001'`),/immutable identity/);
  assert.equal(await sql(`UPDATE brain_continuum_outbox
    SET state='reconcile-required' WHERE delivery_id='continuum-delivery-0001'
    AND source_sha=repeat('a',40) AND lease_generation=3 RETURNING state`),'');
  assert.equal(await sql(`UPDATE brain_continuum_outbox
    SET state='reconcile-required' WHERE delivery_id='continuum-delivery-0001'
    AND source_sha=repeat('a',40) AND lease_generation=2 RETURNING state`),
    'reconcile-required');
  await assert.rejects(sql(`UPDATE brain_continuum_outbox SET state='pending'
    WHERE delivery_id='continuum-delivery-0001'`),/transition forbidden/);
  await assert.rejects(sql(`DELETE FROM brain_continuum_outbox
    WHERE delivery_id='continuum-delivery-0001'`),/deletion forbidden/);
  assert.equal(await sql(`SELECT count(*) FROM brain_continuum_outbox
    WHERE state='reconcile-required'`),'1');
  // An arbitrary caller-supplied future creation date must not extend validity.
  await sql(`INSERT INTO brain_continuum_outbox(
    task_id,objective_id,delivery_id,idempotency_key,repository,source_sha,
    authority_sha,request_sha,lease_generation,expires_at,effect,max_paid_cents,created_at)
    SELECT task_id,objective_id,'continuum-delivery-2099','continuum:delivery:2099',
      repository,source_sha,authority_sha,request_sha,lease_generation,
      statement_timestamp()+interval '1 day',effect,0,
      statement_timestamp()+interval '365 days'
    FROM brain_continuum_outbox LIMIT 1`);
  const timeDrift=Number(await sql(`SELECT ABS(EXTRACT(EPOCH FROM
    (created_at-statement_timestamp())))::int
    FROM brain_continuum_outbox
    WHERE delivery_id='continuum-delivery-2099'`));
  assert.ok(timeDrift<=20,'created_at must be actual database statement time');
  const overlong=insert().replace('continuum-delivery-0001','continuum-delivery-0031')
    .replace('continuum:delivery:0001','continuum:delivery:0031')
    .replace("interval '1 day'","interval '31 days'");
  await assert.rejects(sql(overlong),/check constraint/);

});
