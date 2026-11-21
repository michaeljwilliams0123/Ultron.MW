import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../.github/workflows/',import.meta.url);
const get=name=>readFileSync(new URL(name,root),'utf8');
for(const [name,job,required] of [
 ['composio-v3.yml','isolated-sdk',[
  'npm ci --prefix integrations/composio --ignore-scripts --no-audit --no-fund',
  'npm test --prefix integrations/composio',
  'node integrations/composio/verify-live-primary.mjs --dry-run'
 ]],
 ['secret-isolation.yml','source-secret-audit',[
  'node --test test/secret-isolation-audit.test.mjs',
  'node scripts/audit-secret-isolation.mjs'
 ]]
]){
 test(name+' is manually dispatchable, credentialless and pinned to hosted runner',()=>{
  const y=get(name);
  assert.match(y,/^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(y,/^  (?:push|pull_request|schedule|workflow_run):/m);
  assert.match(y,/^permissions:\n  contents: read\n/m);
  assert.match(y,new RegExp('^  '+job+':\\n','m'));
  assert.match(y,/runs-on: ubuntu-24\.04/);
  assert.match(y,/actions\/checkout@[a-f0-9]{40}/);
  assert.match(y,/actions\/setup-node@[a-f0-9]{40}/);
  assert.match(y,/persist-credentials: false/);
  assert.doesNotMatch(y,/id-token: write|contents: write|secrets\.|\$\{\{\s*vars\./);
  for(const command of required)assert.ok(y.includes(command),name+': missing '+command);
 });
}
test('secret and Composio gates remain mandatory in core verification',()=>{
 const y=get('verify.yml');
 assert.match(y,/node scripts\/audit-secret-isolation\.mjs/);
 assert.match(y,/npm test --prefix integrations\/composio/);
});
