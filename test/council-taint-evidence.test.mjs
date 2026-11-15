import test from 'node:test';
import assert from 'node:assert/strict';
import {scanCouncilChangedFiles,formatCouncilTaintEvidence} from '../src/council-taint-evidence.mjs';
const sha='a'.repeat(40);
test('exact-head AST taint scan identifies real command sink without showing source or tokens',()=>{
 const source="import {exec} from 'node:child_process';\nconst cmd = req.body.command;\nexec(cmd);";
 const e=scanCouncilChangedFiles({sourceSha:sha,prNumber:460,sources:[{
  filename:'src/handler.mjs',source}]});
 assert.equal(e.reports[0].status,'findings');
 assert.ok(e.reports[0].findings.some(x=>x.sink==='exec'));
 const v=formatCouncilTaintEvidence(e);
 assert.match(v,/handler\.mjs/);
 assert.match(v,/exec/);
 assert.doesNotMatch(v,/req\.body\.command/);
});
test('parser failure and missing source never imply a clean security result',()=>{
 const e=scanCouncilChangedFiles({sourceSha:sha,prNumber:460,sources:[
  {filename:'src/invalid.js',source:'function {'},
  {filename:'src/missing.ts',source:null}
 ]});
 assert.equal(e.complete,false);
 assert.deepEqual(e.reports.map(x=>x.status),['parse-error','source-unavailable']);
});
test('malicious path and untrusted source bytes stay out of model summary',()=>{
 const e=scanCouncilChangedFiles({sourceSha:sha,prNumber:460,sources:[
  {filename:'../priv.pem',source:'private'},
  {filename:'src/a.mjs',source:"const credential='ghp_"+"z".repeat(35)+"';"}
 ]});
 assert.equal(e.reports.length,1);
 const text=formatCouncilTaintEvidence(e);
 assert.doesNotMatch(text,/ghp_z|credential/);
 assert.throws(()=>scanCouncilChangedFiles({sourceSha:'bad',prNumber:460,sources:[]}),/taint-input-invalid/);
});
