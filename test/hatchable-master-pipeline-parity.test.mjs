import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ULTRON_REPOSITORY} from '../src/github-principal-policy.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const IMPORT="import {ULTRON_REPOSITORY} from '../github-principal-policy.mjs';";
const INLINED=`const ULTRON_REPOSITORY='${ULTRON_REPOSITORY}';`;
const COPY_NOTE=[
 ' * Hatchable copy (#412) of src/engine/master-pipeline.mjs. Only the repository',
 ' * import is inlined; test/hatchable-master-pipeline-parity.test.mjs fails on drift.',
].join('\n')+'\n';

test('Hatchable master-pipeline copy matches src modulo the repository import rewrite',async()=>{
 const [source,copy]=await Promise.all([read('src/engine/master-pipeline.mjs'),
  read('cloud/hatchable/lib/master-pipeline.js')]);
 assert.equal(source.split(IMPORT).length,2,'src import line must be unique');
 assert.equal(copy.split(INLINED).length,2,'lib must inline the canonical repository');
 assert.equal(copy.split(COPY_NOTE).length,2,'lib must carry the copy note');
 assert.equal(copy.replace(COPY_NOTE,'').replace(INLINED,IMPORT),source);
});

test('Hatchable copy exposes the same pipeline surface without Node fs, git or src imports',async()=>{
 const copy=await read('cloud/hatchable/lib/master-pipeline.js');
 assert.doesNotMatch(copy,/from '\.\.?\//);
 assert.doesNotMatch(copy,/node:(fs|child_process)|process\.env/);
 const [lib,src]=await Promise.all([import('../cloud/hatchable/lib/master-pipeline.js'),
  import('../src/engine/master-pipeline.mjs')]);
 assert.deepEqual(Object.keys(lib).sort(),Object.keys(src).sort());
 for(const name of Object.keys(src))assert.equal(typeof lib[name],typeof src[name],name);
});
