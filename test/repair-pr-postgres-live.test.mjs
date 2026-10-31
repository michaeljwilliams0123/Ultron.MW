// Ephemeral PostgreSQL integration for the real database write fence.
// Runs only under the CI docker-backed acceptance stage, never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if(process.env.ULTRON_POSTGRES_TEST==='1'){
 const ids=execFileSync('docker',
  ['ps','--filter','ancestor=postgres:16-alpine','--format','{{.ID}}'],
  {encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.equal(ids.length,1,'exactly one ephemeral CI PostgreSQL container');
 const container=ids[0];
 function sql(text){
   return execFileSync('docker',['exec',container,'psql','-U','ultron','-d','ultron',
     '-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',text],{
     encoding:'utf8',maxBuffer:1048576
   }).trim();
 }
 function rejects(statement){
   try{sql(statement);return false;}catch{return true;}
 }
 const migration=readFileSync(new URL('../cloud/hatchable/migrations/0012_repair_pr_attempts.sql',
   import.meta.url),'utf8');
 test('real PostgreSQL: CAS phase is monotone; identity rewrite and deletion are denied',()=>{
   sql('DROP TABLE IF EXISTS repair_pr_attempts CASCADE;');
   sql(migration);
   const key='repair:postgres-receipt-001',sha='a'.repeat(64);
   sql(`INSERT INTO repair_pr_attempts(attempt_key,fingerprint,phase)
     VALUES('${key}','${sha}','reserved');`);
   sql(`UPDATE repair_pr_attempts SET phase='branch-dispatch',updated_at=now()
     WHERE attempt_key='${key}';`);
   assert.equal(sql(`SELECT phase FROM repair_pr_attempts WHERE attempt_key='${key}';`),
     'branch-dispatch');
   assert.equal(rejects(`UPDATE repair_pr_attempts SET phase='complete',pr_number=7
     WHERE attempt_key='${key}';`),true);
   assert.equal(rejects(`UPDATE repair_pr_attempts SET fingerprint='${'b'.repeat(64)}'
     WHERE attempt_key='${key}';`),true);
   assert.equal(rejects(`DELETE FROM repair_pr_attempts WHERE attempt_key='${key}';`),true);
   assert.equal(sql(`SELECT phase,fingerprint FROM repair_pr_attempts
     WHERE attempt_key='${key}';`),'branch-dispatch|'+sha);
   assert.equal(rejects(`INSERT INTO repair_pr_attempts(attempt_key,fingerprint,phase)
     VALUES('${key}','${sha}','reserved');`),true);
   sql(`UPDATE repair_pr_attempts SET phase='branch-confirmed',updated_at=now()
     WHERE attempt_key='${key}';`);
   sql(`UPDATE repair_pr_attempts SET phase='pr-dispatch',updated_at=now()
     WHERE attempt_key='${key}';`);
   sql(`UPDATE repair_pr_attempts SET phase='complete',pr_number=7,updated_at=now()
     WHERE attempt_key='${key}';`);
   assert.equal(sql(`SELECT phase,pr_number FROM repair_pr_attempts
     WHERE attempt_key='${key}';`),'complete|7');
   assert.equal(rejects(`UPDATE repair_pr_attempts SET phase='pr-dispatch',pr_number=NULL
     WHERE attempt_key='${key}';`),true);
   sql('DROP TABLE repair_pr_attempts; DROP FUNCTION repair_pr_attempts_fence();');
 });
}
