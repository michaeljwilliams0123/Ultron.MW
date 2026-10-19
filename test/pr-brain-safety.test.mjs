import test from 'node:test';
import assert from 'node:assert/strict';
import {assertModelSourceSafe} from '../src/pr-brain-safety.mjs';

const filename='src/example.mjs';
const source='export const message="old";\n';
const manifest=(path,before,after)=>JSON.stringify({
  objective:'improve source behavior',baseSha:'a'.repeat(40),
  changes:[{path,before,after}],
});
test('compile valid model changes before opening a PR commit',()=>{
  const result=assertModelSourceSafe({path:filename,original:source,
    manifest:manifest(filename,'old','new')});
  assert.equal(result.validated,true);
  assert.equal(result.candidate,'export const message="new";\n');
});
test('invalid syntax is rejected before calling GitHub write adapters',()=>{
  assert.throws(()=>assertModelSourceSafe({path:filename,original:source,
    manifest:manifest(filename,'export const message="old";','export const message="new";);')}),/syntax preflight/);
});
test('small model cannot hallucinate capability evidence paths',()=>{
  const original="export const x={proof:Object.freeze(['test/real.test.mjs'])};\n";
  const content="export const x={proof:Object.freeze(['test/fake.test.mjs'])};\n";
  assert.throws(()=>assertModelSourceSafe({path:'docs/core/capabilities.mjs',
    original,manifest:manifest('docs/core/capabilities.mjs',original.trim(),content.trim())}),/cannot alter capability proof/);
});
test('original source context remains single-match and path scoped',()=>{
  assert.throws(()=>assertModelSourceSafe({path:filename,original:source,
    manifest:manifest('src/other.mjs','old','new')}),/observed source path/);
  assert.throws(()=>assertModelSourceSafe({path:filename,original:'old old',
    manifest:manifest(filename,'old','new')}),/ambiguous/);
});
