import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../cloud/hatchable/',import.meta.url);
const source=path=>readFileSync(new URL(path,root),'utf8');

test('C04 creates two bounded, relational and replayable advisory ledgers',()=>{
 const schema=source('migrations/0027_council_case_memory.sql');
 assert.match(schema,/CREATE TABLE IF NOT EXISTS brain_council_cases\s*\(/i);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS brain_council_assessments\s*\(/i);
 assert.match(schema,/case_digest TEXT NOT NULL UNIQUE/i);
 assert.match(schema,/REFERENCES brain_tasks\(id\) ON DELETE RESTRICT/i);
 assert.match(schema,/REFERENCES brain_council_cases\(id\) ON DELETE RESTRICT/i);
 assert.match(schema,/PRIMARY KEY\s*\(case_id,role_id\)/i);
 assert.match(schema,/identity_state TEXT NOT NULL DEFAULT 'unverified'/);
 assert.match(schema,/independence_verified BOOLEAN NOT NULL DEFAULT FALSE/);
 assert.match(schema,/CHECK \(NOT independence_verified\)/);
});

test('C04 Council room persists its complete result atomically behind a fenced task completion',()=>{
 const runner=source('lib/brain-runner.js');
 const completion=runner.slice(runner.indexOf('const done=await db.query'));
 assert.match(completion,/WHERE id=\$2 AND owner_token=\$3 AND status='leased'/);
 assert.match(completion,/fencing_generation=\$6/);
 assert.match(completion,/INSERT INTO brain_council_cases/);
 assert.match(completion,/INSERT INTO brain_council_assessments/);
 assert.match(completion,/FROM moved[\s\S]*?WHERE moved\.objective='council\.room'/);
 assert.match(completion,/ON CONFLICT \(case_digest\) DO NOTHING/);
 assert.match(completion,/ON CONFLICT \(case_id,role_id\) DO NOTHING/);
 assert.match(completion,/jsonb_array_elements\(\$1::jsonb->'members'\)/);
});

test('C04 fingerprints substantive evidence, not timestamp, using database SHA-256',()=>{
 const runner=source('lib/brain-runner.js');
 assert.match(runner,/sha256\(convert_to\(/);
 assert.match(runner,/\$1::jsonb - 'at'/);
 assert.match(runner,/c04-advisory-v1/);
 assert.match(runner,/council\.room/);
});

test('C04 ledger does not manufacture independent authenticated assessments',()=>{
 const sql=source('migrations/0027_council_case_memory.sql');
 const runner=source('lib/brain-runner.js');
 assert.match(sql,/CHECK \(identity_state='unverified'\)/);
 assert.match(sql,/CHECK \(NOT independence_verified\)/);
 assert.match(runner,/'unverified',false/);
 assert.doesNotMatch(runner,/githubRoleInstallationsObserved\s*[:=]\s*7/);
});
