import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {auditHatchableSourceParity} from '../scripts/hatchable-source-parity.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
function fixture(entries,liveExtras=[]){
 const root=mkdtempSync(join(tmpdir(),'hatchable-parity-'));
 for(const [path,data] of entries){
  const file=join(root,...path.split('/'));
  mkdirSync(dirname(file),{recursive:true});
  writeFileSync(file,data);
 }
 const files=liveExtras.map(([path,body])=>({path,hash:digest(body)}));
 return{root,files};
}
const dispose=f=>rmSync(f.root,{recursive:true,force:true});
test('exact bytes verify; digest alone is never a signed release',()=>{
 const f=fixture([['api/a.js','export const a=1;\n']]);
 try{
  const result=auditHatchableSourceParity({version:119,files:[{path:'api/a.js',hash:digest('export const a=1;\n')}]},f.root);
  assert.equal(result.byteExactParity,true);
  assert.equal(result.signedReleaseVerified,false);
  assert.equal(result.counts.exact,1);
  assert.equal(result.counts.finalNewlineOnly,0);
 }finally{dispose(f)}
});
test('terminal LF mismatch is classified separately, never exact',()=>{
 const f=fixture([['lib/a.js','const a=1;\n']]);
 try{
  const result=auditHatchableSourceParity({version:119,files:[{path:'lib/a.js',hash:digest('const a=1;')}]},f.root);
  assert.equal(result.byteExactParity,false);
  assert.deepEqual(result.finalNewlineOnly,['lib/a.js']);
  assert.equal(result.counts.substantiveDrift,0);
 }finally{dispose(f)}
});
test('source content drift and missing authored deployment are distinct',()=>{
 const f=fixture([['api/a.js','old\n']]);
 try{
  const result=auditHatchableSourceParity({version:119,files:[
   {path:'api/a.js',hash:digest('new\n')},
   {path:'migrations/0048.sql',hash:digest('ALTER TABLE x;')}
  ]},f.root);
  assert.deepEqual(result.substantiveDrift,['api/a.js']);
  assert.deepEqual(result.missingInSource,['migrations/0048.sql']);
  assert.equal(result.byteExactParity,false);
 }finally{dispose(f)}
});
test('undeployed authored code blocks parity but documentation does not',()=>{
 const f=fixture([['api/a.js','hello'],['lib/unshipped.js','more'],['README.md','docs']]);
 try{
  const result=auditHatchableSourceParity({version:119,files:[{path:'api/a.js',hash:digest('hello')}]},f.root);
  assert.deepEqual(result.sourceOnlyDeployable,['lib/unshipped.js']);
  assert.equal(result.byteExactParity,false);
 }finally{dispose(f)}
});
test('manifests with traversal, duplicate files, absent hash, or empty list never verify',()=>{
 const f=fixture([['api/a.js','hello']]);
 try{
  for(const files of [
   [{path:'../private.txt',hash:digest('hello')}],
   [{path:'api/a.js',hash:digest('hello')},{path:'api/a.js',hash:digest('hello')}],
   [{path:'api/a.js'}],
   []
  ])assert.throws(()=>auditHatchableSourceParity({version:119,files},f.root));
 }finally{dispose(f)}
});
