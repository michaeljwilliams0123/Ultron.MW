import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const wf=readFileSync(new URL('../.github/workflows/council-debate.yml',import.meta.url),'utf8');
const diagnostic=readFileSync(new URL('../scripts/diagnose-council-installation.mjs',import.meta.url),'utf8');

test('both owner-gated Council proof lanes use only the current Coordinator App secret',()=>{
 assert.equal((wf.match(/secrets\.ULTRON_COORDINATOR_PRIVATE_KEY/g)||[]).length,4);
 assert.doesNotMatch(wf,/secrets\.ULTRON_BUILDER_PRIVATE_KEY/);
 assert.match(wf,/ULTRON_COORDINATOR_PRIVATE_KEY:\s*\$\{\{ secrets\.ULTRON_COORDINATOR_PRIVATE_KEY \}\}/);
 assert.match(wf,/private-key:\s*\$\{\{ secrets\.ULTRON_COORDINATOR_PRIVATE_KEY \}\}/);
 assert.match(wf,/ACTUAL_APP_SLUG.*steps\.app\.outputs\.app-slug/);
 assert.match(wf,/EXPECTED_APP_ID:\s*\$\{\{ vars\.ULTRON_GITHUB_APP_ID \}\}/);
});
test('Coordinator installation diagnostic consumes the current private-key environment binding',()=>{
 assert.match(diagnostic,/process\.env\.ULTRON_COORDINATOR_PRIVATE_KEY/);
 assert.doesNotMatch(diagnostic,/process\.env\.ULTRON_BUILDER_PRIVATE_KEY/);
});
