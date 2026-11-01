// Ephemeral PostgreSQL integration for the real database write fence.
// Runs only under the CI docker-backed acceptance stage, never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if(process.env.ULTRON_POSTGRES_TEST==='1'){
 // Never auto-select a running database by image: it might be persistent.
 // GitHub Actions pins this ID to the exact job-scoped postgres service.
 const container=process.env.ULTRON_POSTGRES_CONTAINER_ID;
 assert.match(container??'',/^[a-f0-9]{12,64}$/i,'explicit CI PostgreSQL service ID required');
 const details=JSON.parse(execFileSync('docker',
  ['inspect','--format','{{json .}}',container],{encoding:'utf8'}));
 assert.equal(details.Config.Image,'postgres:16-alpine','refuse non-CI image');
 assert.equal(details.State.Running,true,'CI service must be running');
 assert.ok(details.Config.Env.includes('ULTRON_TEST_POSTGRES=repair-ci-ephemeral-v1'),
  'refuse unmarked or persistent PostgreSQL containers');
 assert.ok(details.Config.Env.includes('POSTGRES_USER=ultron'));
 assert.ok(details.Config.Env.includes('POSTGRES_DB=ultron'));
 assert.ok(!(details.Mounts??[]).some(m=>m.Type==='bind'),
  'refuse bind-mounted PostgreSQL storage');
 // Never run a destructive fixture against an existing shared application DB.
 // An unpredictable newly created database is the sole test write target.
 const scratchDb='ultron_repair_ci_'+randomBytes(8).toString('hex');
 function admin(text){
   return execFileSync('docker',['exec',container,'psql','-U','ultron','-d','postgres',
     '-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',text],
     {encoding:'utf8',maxBuffer:1048576}).trim();
 }
 function sql(text){
   return execFileSync('docker',['exec',container,'psql','-U','ultron','-d',scratchDb,
     '-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',text],{
     encoding:'utf8',maxBuffer:1048576
   }).trim();
 }
 function rejects(statement,pattern){
   if(!(pattern instanceof RegExp))throw Error('Expected PostgreSQL rejection pattern');
   try{sql(statement);return false;}
   catch(error){return pattern.test(String(error.stderr||error.message||error));}
 }
 const migration=readFileSync(new URL('../cloud/hatchable/migrations/0012_repair_pr_attempts.sql',
   import.meta.url),'utf8');
 test('real PostgreSQL: CAS phase is monotone; identity rewrite and deletion are denied',()=>{
   admin('CREATE DATABASE '+scratchDb);
   try {
   sql(migration);
   // A generic SQL failure is not proof the intended ledger fence fired.
   assert.equal(rejects('SELECT 1/0',/repair_pr_attempts transition denied/),false);
   const key='repair:postgres-receipt-001',sha='a'.repeat(64);
   sql(`INSERT INTO repair_pr_attempts(attempt_key,fingerprint,phase)
     VALUES('${key}','${sha}','reserved');`);
   sql(`UPDATE repair_pr_attempts SET phase='branch-dispatch',updated_at=now()
     WHERE attempt_key='${key}';`);
   assert.equal(sql(`SELECT phase FROM repair_pr_attempts WHERE attempt_key='${key}';`),
     'branch-dispatch');
   assert.equal(rejects(`UPDATE repair_pr_attempts SET phase='complete',pr_number=7
     WHERE attempt_key='${key}';`,/repair_pr_attempts transition denied/),true);
   assert.equal(rejects(`UPDATE repair_pr_attempts SET fingerprint='${'b'.repeat(64)}'
     WHERE attempt_key='${key}';`,/repair_pr_attempts identity immutable/),true);
   assert.equal(rejects(`DELETE FROM repair_pr_attempts WHERE attempt_key='${key}';`,/repair_pr_attempts deletion denied/),true);
   assert.equal(sql(`SELECT phase,fingerprint FROM repair_pr_attempts
     WHERE attempt_key='${key}';`),'branch-dispatch|'+sha);
   assert.equal(rejects(`INSERT INTO repair_pr_attempts(attempt_key,fingerprint,phase)
     VALUES('${key}','${sha}','reserved');`,/duplicate key/),true);
   sql(`UPDATE repair_pr_attempts SET phase='branch-confirmed',updated_at=now()
     WHERE attempt_key='${key}';`);
   sql(`UPDATE repair_pr_attempts SET phase='pr-dispatch',updated_at=now()
     WHERE attempt_key='${key}';`);
   sql(`UPDATE repair_pr_attempts SET phase='complete',pr_number=7,updated_at=now()
     WHERE attempt_key='${key}';`);
   assert.equal(sql(`SELECT phase,pr_number FROM repair_pr_attempts
     WHERE attempt_key='${key}';`),'complete|7');
   assert.equal(rejects(`UPDATE repair_pr_attempts SET phase='pr-dispatch',pr_number=NULL
     WHERE attempt_key='${key}';`,/repair_pr_attempts transition denied/),true);
   } finally {
     // Remove only the random test database created above, even on failure.
     admin('DROP DATABASE '+scratchDb+' WITH (FORCE)');
   }
 });
}
