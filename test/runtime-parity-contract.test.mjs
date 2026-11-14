import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {auditRuntimeParity,PARITY_PAIRS} from '../scripts/check-runtime-parity.mjs';

const ROOT=new URL('../',import.meta.url);

test('G1 Coordinator App proof source must be pinned to its deployed Hatchable mirror',()=>{
 const pair=['src/identity/github-app-installation-proof.mjs',
  'cloud/hatchable/lib/github-app-installation-proof.js'];
 assert.ok(PARITY_PAIRS.some(p=>p[0]===pair[0]&&p[1]===pair[1]),
  'the G1 scoped-App proof is a required release mirror');
 const sources=PARITY_PAIRS.map(p=>p[0]),targets=PARITY_PAIRS.map(p=>p[1]);
 assert.equal(new Set(sources).size,sources.length,'mirror sources must be unique');
 assert.equal(new Set(targets).size,targets.length,'mirror destinations must be unique');
});


test('canonical authored modules and deployed mirrors are byte-identical',async()=>{
 const proof=await auditRuntimeParity({root:ROOT});
 assert.ok(PARITY_PAIRS.length>=12,'verify both runtime and browser mirror families');
 assert.equal(proof.checked,PARITY_PAIRS.length);
 assert.deepEqual(proof.mismatches,[]);
});

test('mismatched runtime file fails with path-specific, non-secret evidence',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ultron-parity-'));
 t.after(()=>rm(dir,{force:true,recursive:true}));
 const files=[['src/foo.mjs','export const x=1;\n'],['cloud/hatchable/lib/foo.js','export const x=2;\n']];
 for(const [path,content] of files){await mkdir(dirname(join(dir,path)),{recursive:true});await writeFile(join(dir,path),content);}
 const report=await auditRuntimeParity({root:dir,pairs:[['src/foo.mjs','cloud/hatchable/lib/foo.js']]});
 assert.equal(report.checked,1);
 assert.equal(report.mismatches.length,1);
 assert.equal(report.mismatches[0].source,'src/foo.mjs');
 assert.equal(report.mismatches[0].target,'cloud/hatchable/lib/foo.js');
 assert.equal(report.mismatches[0].reason,'sha256-mismatch');
 assert.notEqual(report.mismatches[0].sourceSha256,report.mismatches[0].targetSha256);
});

test('missing target fails closed instead of silently skipping a mirror',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ultron-parity-'));
 t.after(()=>rm(dir,{force:true,recursive:true}));
 await mkdir(join(dir,'src'),{recursive:true});
 await writeFile(join(dir,'src/foo.mjs'),'export const x=1;\n');
 const proof=await auditRuntimeParity({root:dir,pairs:[['src/foo.mjs','cloud/hatchable/lib/foo.js']]});
 assert.deepEqual(proof.mismatches.map(x=>x.reason),['missing-target']);
});
