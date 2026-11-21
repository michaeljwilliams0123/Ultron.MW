import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const script=fileURLToPath(new URL('../scripts/verify-deployed-source-parity.mjs',import.meta.url));
const sha=text=>createHash('sha256').update(text).digest('hex');
function run(files,write=()=>{
}){
 const temp=mkdtempSync(join(tmpdir(),'ultron-parity-'));
 const root=join(temp,'cloud');mkdirSync(root);
 const m=join(temp,'manifest.json');writeFileSync(m,JSON.stringify(files));
 write(root);
 const result=spawnSync(process.execPath,[script,m,root],{encoding:'utf8'});
 rmSync(temp,{recursive:true,force:true});
 return {code:result.status,stdout:result.stdout,stderr:result.stderr,
  body:(()=>{try{return JSON.parse(result.stdout)}catch{return null}})()};
}
test('exact immutable manifest matches bytes and produces a canonical digest',()=>{
 const out=run([{path:'lib/ok.js',hash:sha('hello')}],root=>{
  mkdirSync(join(root,'lib'));writeFileSync(join(root,'lib','ok.js'),'hello');
 });
 assert.equal(out.code,0,out.stderr);
 assert.equal(out.body?.matched,1);
 assert.equal(out.body?.missing,0);
 assert.equal(out.body?.different,0);
 assert.match(out.body?.artifactDigest||'',/^sha256:[a-f0-9]{64}$/);
});
test('changed on-disk content is detected independently, not accepted',()=>{
 const out=run([{path:'changed.js',hash:sha('expected')}],root=>{
  writeFileSync(join(root,'changed.js'),'tampered');
 });
 assert.equal(out.code,1);assert.equal(out.body?.different,1);
});
test('missing declared source is a hard parity failure',()=>{
 const out=run([{path:'missing.js',hash:sha('file')}]);
 assert.equal(out.code,1);assert.equal(out.body?.missing,1);
});
test('path traversal is rejected without ever inspecting outside the source root',()=>{
 const out=run([{path:'../outside.js',hash:sha('file')}]);
 assert.equal(out.code,1);assert.equal(out.body?.error,'manifest-invalid-path');
});
test('duplicate manifest entries fail closed',()=>{
 const out=run([{path:'duplicate.js',hash:sha('one')},
 {path:'duplicate.js',hash:sha('two')}]);
 assert.equal(out.code,1);assert.equal(out.body?.error,'manifest-duplicate-path');
});

test('symlinked source file cannot escape verified root, even with matching bytes',t=>{
 let supported=true;
 const out=run([{path:'leak.js',hash:sha('outside-file')}],root=>{
  const target=join(root,'..','private-test-fixture.txt');
  writeFileSync(target,'outside-file');
  try{symlinkSync(target,join(root,'leak.js'),'file');}
  catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e?.code)){supported=false;return;}throw e;}
 });
 if(!supported){t.skip('local OS disallows symlink fixture');return;}
 assert.equal(out.code,1);
 assert.equal(out.body?.error,'manifest-invalid-path');
});
