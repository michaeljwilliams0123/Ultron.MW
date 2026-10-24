import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../cloud/hatchable/public/index.html',import.meta.url),'utf8');

test('hosted cloud root has one actual static page and the canonical Ultron UI link',()=>{
 assert.match(html,/<!doctype html>/i);
 assert.match(html,/<title>Ultron\.MW — Cloud Brain<\/title>/);
 assert.match(html,/https:\/\/michaeljwilliams0123\.github\.io\/Ultron\.MW\//);
 assert.match(html,/https:\/\/hatchable\.com\/console\/projects\/ultron-mw-cloud\/setup/);
});
test('Descope UI points at existing sign-in flow with exact pinned component version',()=>{
 assert.match(html,/descope-wc project-id="P3L7irCEJ6yLtlWrWjhabW5B7E0g" flow-id="sign-in"/);
 assert.match(html,/@descope\/web-component@4\.4\.11\/dist\/index\.js/);
 assert.doesNotMatch(html,/flow-id="sign-up-or-in"/);
 assert.doesNotMatch(html,/@latest\b|@x\.x\.x/);
});
test('identity-only landing does not confer cloud backend authority',()=>{
 assert.match(html,/Server-side Descope session validation/);
 assert.match(html,/does not grant permission/);
 assert.doesNotMatch(html,/fetch\s*\(\s*['"]\/api\/brain\//);
 assert.doesNotMatch(html,/ULTRON_MAHORAGA_GITHUB_APP_PRIVATE_KEY|DESCOPE_MANAGEMENT_KEY|sk-proj-|ghp_[A-Za-z0-9]+/);
});
