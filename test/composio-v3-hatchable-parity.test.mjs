import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
test('Composio v3 policy is byte-identical under Hatchable source mirror',async()=>{
 assert.equal(await read('src/composio-v3-policy.mjs'),
  await read('cloud/hatchable/lib/composio-v3-policy.js'));
});
test('Hatchable readiness source is admin only, zero cost and non-accepting',async()=>{
 const source=await read('cloud/hatchable/api/brain/composio-v3.js');
 assert.match(source,/export const access='admin'/);
 assert.match(source,/productionAccepted:false/);
 assert.match(source,/paidCeilingCents:0/);
 assert.match(source,/owner-identity-required/);
 assert.doesNotMatch(source,/console\.log\(.*config/);
});
test('Composio Node SDK runtime isolated from root runtime',async()=>{
 const rootPackage=JSON.parse(await read('package.json'));
 const worker=JSON.parse(await read('integrations/composio/package.json'));
 assert.equal(rootPackage.engines.node,'>=20');
 assert.equal(worker.engines.node,'>=22.22.3');
 assert.equal(worker.type,'module');
 assert.equal(worker.dependencies['@composio/core'],'0.29.0');
});
