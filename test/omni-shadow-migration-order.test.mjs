import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const migration = name => fileURLToPath(new URL('../cloud/hatchable/migrations/'+name,import.meta.url));

test('shadow evidence owns migration 0049, never the canonical 0047 filename',()=>{
 const shadow=migration('0049_omni_shadow_evidence.sql');
 assert.equal(existsSync(shadow),true,'additive shadow evidence must use its own 0049 migration');
 assert.match(readFileSync(shadow,'utf8'),/CREATE TABLE IF NOT EXISTS brain_omni_shadow_events/);
 const canonical=migration('0047_omni_state_machine.sql');
 if(existsSync(canonical)){
  const sql=readFileSync(canonical,'utf8');
  assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS brain_omni_shadow_events/,
   '0047 must not contain the competing shadow event ledger');
 }
});
