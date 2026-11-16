import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compareHatchableDeployment} from '../src/evidence/hatchable-deployment-parity.mjs';
import {run} from '../scripts/check-hatchable-deployment-parity.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const sha='a'.repeat(40),version=120;
const sourceFiles=[
 {path:'api/ok.js',sha256:hash('ok\n'),withoutFinalLfSha256:hash('ok')},
 {path:'lib/newline.js',sha256:hash('test\n'),withoutFinalLfSha256:hash('test')},
 {path:'lib/change.js',sha256:hash('before\n'),withoutFinalLfSha256:hash('before')},
 {path:'lib/missing.js',sha256:hash('not deployed')}
];
const deployedFiles=[
 {path:'api/ok.js',hash:hash('ok\n')},
 {path:'lib/newline.js',hash:hash('test')},
 {path:'lib/change.js',hash:hash('after')},
 {path:'api/live-only.js',hash:hash('live')}
];
test('reports byte parity, final-LF drift, material drift and absent files distinctly',()=>{
 const a=compareHatchableDeployment({sourceSha:sha,version,sourceFiles,deployedFiles});
 const b=compareHatchableDeployment({sourceSha:sha,version,
  sourceFiles:[...sourceFiles].reverse(),deployedFiles:[...deployedFiles].reverse()});
 assert.equal(a.exactCount,1);
 assert.deepEqual(a.newlineOnly,['lib/newline.js']);
 assert.deepEqual(a.contentDrift,['lib/change.js']);
 assert.deepEqual(a.missingLive,['lib/missing.js']);
 assert.deepEqual(a.liveOnly,['api/live-only.js']);
 assert.equal(a.deploymentManifestSha256,b.deploymentManifestSha256);
 assert.equal(a.sourceManifestSha256,b.sourceManifestSha256);
 assert.equal(a.releaseAccepted,false);
 assert.equal(a.independentlySigned,false);
 assert.equal(a.byteExact,false);
});
test('byte-exact match is parity-only, not release approval',()=>{
 const r=compareHatchableDeployment({sourceSha:sha,version,
  sourceFiles:[{path:'a.js',sha256:hash('exact')}],deployedFiles:[{path:'a.js',hash:hash('exact')}]});
 assert.equal(r.byteExact,true);
 assert.equal(r.releaseAccepted,false);
 assert.match(r.status,/not-release-authorized/);
});
test('rejects malformed or duplicate external inventories',()=>{
 const base={sourceSha:sha,version,sourceFiles,deployedFiles};
 assert.throws(()=>compareHatchableDeployment({...base,sourceFiles:[sourceFiles[0],sourceFiles[0]]}),/inventory-invalid/);
 assert.throws(()=>compareHatchableDeployment({...base,deployedFiles:[{path:'../secret',hash:hash('a')}]}),/inventory-invalid/);
 assert.throws(()=>compareHatchableDeployment({...base,sourceSha:'main'}),/provenance-invalid/);
 assert.throws(()=>compareHatchableDeployment({...base,deployedFiles:[{path:'a',hash:'invalid'}]}),/inventory-invalid/);
});
test('fail closed: zero-record inventories can never prove byte-exact parity',()=>{
 const base={sourceSha:sha,version,
  sourceFiles:[{path:'api/ok.js',sha256:hash('ok')}],
  deployedFiles:[{path:'api/ok.js',hash:hash('ok')}]};
 for(const variant of [
  {sourceFiles:[],deployedFiles:[]},
  {sourceFiles:[]},
  {deployedFiles:[]}
 ])assert.throws(()=>compareHatchableDeployment({...base,...variant}),
  /inventory-invalid/);
});
test('CLI rejects an independently observed manifest for a different version',t=>{
 const d=mkdtempSync(join(tmpdir(),'ultron-deploy-parity-'));
 t.after(()=>rmSync(d,{recursive:true,force:true}));
 const p=join(d,'manifest.json');
 writeFileSync(p,JSON.stringify(deployedFiles));
 assert.throws(()=>run(['--source',sha,'--manifest',p,'--version','120'],()=>sourceFiles),/manifest-input-invalid/);
 writeFileSync(p,JSON.stringify({version:119,file_manifest:deployedFiles}));
 assert.throws(()=>run(['--source',sha,'--manifest',p,'--version','120'],()=>sourceFiles),/manifest-input-invalid/);
 writeFileSync(p,JSON.stringify({version:120,file_manifest:deployedFiles}));
 const r=run(['--source',sha,'--manifest',p,'--version','120'],()=>sourceFiles);
 assert.equal(r.contentDrift.length,1);
});
