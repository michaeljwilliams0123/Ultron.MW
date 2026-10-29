import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../cloud/hatchable/public/index.html', import.meta.url), 'utf8');

test('hosted cloud root has one static landing and links to canonical Ultron UI', () => {
 assert.ok(html.toLowerCase().includes('<!doctype html>'));
 assert.ok(html.includes('<title>Ultron.MW — Cloud Brain</title>'));
 assert.ok(html.includes('https://michaeljwilliams0123.github.io/Ultron.MW/'));
 assert.ok(html.includes('https://hatchable.com/console/projects/ultron-mw-cloud/setup'));
});
test('Descope identity box and scripts are absent', () => {
 for (const term of ['descope-wc','descopecdn','identity-status','flow-id','Descope identity sign-in','Sign in with Google'])
   assert.ok(!html.toLowerCase().includes(term.toLowerCase()), 'Unexpected legacy login: '+term);
});
test('static landing cannot create privileged brain requests', () => {
 assert.ok(html.includes('Owner-only functions remain protected by Hatchable access controls'));
 for (const term of ['/api/brain/', 'ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY', 'DESCOPE_MANAGEMENT_KEY', 'sk-proj-', 'ghp_'])
   assert.ok(!html.includes(term), 'Unexpected privileged reference: '+term);
});
