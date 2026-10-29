import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../cloud/hatchable/public/index.html',import.meta.url),'utf8');

test('hosted cloud root has one static landing and links to canonical Ultron UI',()=>{
 assert.match(html,/<!doctype html>/i);
 assert.match(html,/<title>Ultron\\.MW — Cloud Brain<\\/title>/);
 assert.match(html,/https:\\/\\/michaeljwilliams0123\\.github\\.io\\/Ultron\\.MW\\//);
 assert.match(html,/https:\\/\\/hatchable\\.com\\/console\\/projects\\/ultron-mw-cloud\\/setup/);
});
test('Descope identity box, script and event listeners are absent',()=>{
 assert.doesNotMatch(html,/descope-wc|descopecdn|identity-status|flow-id|Descope identity sign-in/i);
 assert.doesNotMatch(html,/sign in with Google|addEventListener\\(['"]success/i);
});
test('static landing cannot create privileged brain requests',()=>{
 assert.match(html,/Owner-only functions remain protected by Hatchable access controls/);
 assert.doesNotMatch(html,/fetch\\s*\\(\\s*['"]\\/api\\/brain\\//);
 assert.doesNotMatch(html,/ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY|DESCOPE_MANAGEMENT_KEY|sk-proj-|ghp_[A-Za-z0-9]+/);
});
