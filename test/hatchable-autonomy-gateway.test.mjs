import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const runner=await readFile(new URL('../cloud/hatchable/lib/brain-runner.js',import.meta.url),'utf8');
const claim=runner.match(/const claim=await db\.query\(\x60([\s\S]*?)\x60,\[token\]\)/)?.[1];

test('C18 RED: Hatchable gateway cannot misparse JSONB membership as bind parameters',()=>{
 assert.ok(claim,'must inspect the actual scheduled PostgreSQL claim query');
 assert.doesNotMatch(claim,/allowed_operations\s*\?/,
   'Hatchable SQL gateway treats JSONB question-mark as an unbound positional placeholder');
 const expected=['repo.inspect','evidence.read','research.public','plan.create'];
 for(const operation of expected){
   assert.ok(claim.includes("jsonb_exists(autonomy.allowed_operations,'"+operation+"')"),
      operation+' must use the Hatchable-compatible built-in PostgreSQL function');
 }
 assert.match(claim,/brain_owner_autonomy_profile/);
 assert.match(claim,/FOR SHARE/);
});
