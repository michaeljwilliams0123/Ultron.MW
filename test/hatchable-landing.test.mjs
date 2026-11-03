import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../cloud/hatchable/public/index.html',import.meta.url),'utf8');
test('Hatchable becomes the single owner-facing cloud console with protected profile controls',()=>{
 assert.ok(html.toLowerCase().includes('<!doctype html>'));
 assert.ok(html.includes('<title>Ultron.MW — Cloud Brain</title>'));
 assert.ok(html.includes('Autonomy profiles'));
 assert.ok(html.includes('https://github.com/michaeljwilliams0123/Ultron.MW'));
 assert.ok(html.includes('https://hatchable')===false || html.includes('Hatchable'));
});
test('public HTML never embeds identity credentials or repeats legacy login',()=>{
 for(const word of ['descope-wc','descopecdn','DESCOPE_MANAGEMENT_KEY',
   'ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY','sk-proj-','ghp_'])
  assert.ok(!html.includes(word),'Unexpected secret/legacy login in UI: '+word);
});
test('client only saves settings through admin-only endpoint and no privileged writes are automated',async()=>{
 const route=await readFile(new URL('../cloud/hatchable/api/brain/autonomy.js',import.meta.url),'utf8');
 assert.match(route,/export const access='admin'/);
 assert.match(route,/setOwnerProfile/);
 assert.ok(html.includes('/api/brain/autonomy'));
 assert.ok(html.includes("credentials:'same-origin'"));
 assert.doesNotMatch(html,/\/api\/brain\/(?:authority|mahoraga|run|tick)/);
 assert.ok(html.includes('Owner-only functions remain protected by Hatchable access controls'));
});
