import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('runtime-test configuration cannot bind any remote resources',()=>{
  const c=JSON.parse(read('cloudflare/edge-shield/wrangler.runtime-test.json'));
  assert.deepEqual(Object.keys(c).sort(),['compatibility_date','compatibility_flags','main','name','vars','workers_dev']);
  assert.equal(c.main,'src/index.ts');
  assert.equal(c.workers_dev,false);
  assert.deepEqual(c.vars,{ENVIRONMENT:'runtime-test',HATCHABLE_CORE_ORIGIN:'https://example.invalid',ENFORCE_CSP:'false'});
});
test('isolated preview config declares no production bindings',()=>{
  const c=JSON.parse(read('cloudflare/edge-shield/wrangler.preview.json'));
  assert.deepEqual(Object.keys(c).sort(),['compatibility_date','compatibility_flags','main','name','previews','workers_dev']);
  assert.equal(c.main,'src/preview.ts');
  assert.equal(c.name,'ultron-edge-shield-preview');
  assert.equal(c.workers_dev,false);
  assert.deepEqual(c.previews,{vars:{ENVIRONMENT:'isolated-preview'}});
});
