import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ULTRON_REPOSITORY} from '../src/github-principal-policy.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const IMPORT="import {ULTRON_REPOSITORY} from '../github-principal-policy.mjs';";
const INLINED=`const ULTRON_REPOSITORY='${ULTRON_REPOSITORY}';`;
const COPY_NOTE=[
 ' * Hatchable copy (#412) of src/engine/master-pipeline.mjs. Only the repository',
 ' * import is inlined and loadLiveDependencies is a throwing stub;',
 ' * test/hatchable-master-pipeline-parity.test.mjs fails on any other drift.',
].join('\n')+'\n';
const HEAD='export async function loadLiveDependencies(){\n';
const STUB=HEAD+[
 '  // Hatchable deploys only cloud/hatchable; the src/scripts live chain is',
 '  // absent there. lib/github-branch-canary.js injects native adapters instead.',
 "  throw Error('canary-live-dependencies-unavailable-on-hatchable');",
].join('\n')+'\n}\n';
// Excludes ONLY the loadLiveDependencies body; everything else must match.
function withoutLiveBody(text){
 const start=text.indexOf(HEAD);
 assert.ok(start>=0,'loadLiveDependencies must exist');
 assert.equal(text.indexOf(HEAD,start+1),-1);
 const end=text.indexOf('\n}\n',start)+3;
 return {body:text.slice(start,end),rest:text.slice(0,start)+HEAD+'<body>\n}\n'+text.slice(end)};
}

test('Hatchable master-pipeline copy matches src modulo the repository import rewrite',async()=>{
 const [source,copy]=await Promise.all([read('src/engine/master-pipeline.mjs'),
  read('cloud/hatchable/lib/master-pipeline.js')]);
 assert.equal(source.split(IMPORT).length,2,'src import line must be unique');
 assert.equal(copy.split(INLINED).length,2,'lib must inline the canonical repository');
 assert.equal(copy.split(COPY_NOTE).length,2,'lib must carry the copy note');
 const lib=withoutLiveBody(copy.replace(COPY_NOTE,'').replace(INLINED,IMPORT));
 assert.equal(lib.body,STUB);
 assert.equal(lib.rest,withoutLiveBody(source).rest);
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

test('Hatchable loadLiveDependencies stub fails closed with a clear error',async()=>{
 const lib=await import('../cloud/hatchable/lib/master-pipeline.js');
 await assert.rejects(lib.loadLiveDependencies(),
  {message:'canary-live-dependencies-unavailable-on-hatchable'});
 const copy=await read('cloud/hatchable/lib/master-pipeline.js');
 assert.doesNotMatch(copy,/import\(/);
});
