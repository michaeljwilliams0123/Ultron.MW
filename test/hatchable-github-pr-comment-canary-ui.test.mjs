import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../cloud/hatchable/public/github-pr-comment-canary.html',import.meta.url),'utf8');
const js=await readFile(new URL('../cloud/hatchable/public/github-pr-comment-canary.js',import.meta.url),'utf8');
test('owner UI exposes prepare, one submit and readback-only reconciliation without a key field',()=>{
 assert.match(html,/Prepare owner grant/);
 assert.match(html,/Submit one App comment/);
 assert.match(html,/Read back existing attempt/);
 assert.doesNotMatch(html,/(?:private[-_ ]?key|passcode|password)["']?\s*(?:id|name)=/i);
 assert.match(js,/mode:'prepare'/);
 assert.match(js,/execute\('submit'\)/);
 assert.match(js,/execute\('reconcile'\)/);
 assert.match(js,/if\(value[.]ok\)envelope[.]value=''/);
 assert.match(js,/credentials:'include'/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|Authorization/);
});
