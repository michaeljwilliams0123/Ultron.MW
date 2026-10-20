import test from 'node:test';
import assert from 'node:assert/strict';
import { routePrTurn, needsPrModelRuntime } from '../src/pr-brain.mjs';
test('PR brain routes multi-file objective to CPU inference lane',()=>{
  const phrase='@ultron implement files docs/a.md, docs/b.md: update multiple existing files';
  const route=routePrTurn(phrase);
  assert.equal(route.kind,'implement-multi');
  assert.deepEqual(route.paths,['docs/a.md','docs/b.md']);
  assert.equal(needsPrModelRuntime(phrase),true);
});
test('invalid source path is not treated as general implement',()=>{
  assert.equal(routePrTurn('@ultron implement files docs/a.md, .github/unsafe.yml: repair all').kind,'invalid-multi');
});
