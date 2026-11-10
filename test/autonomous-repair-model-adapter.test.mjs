import test from 'node:test';
import assert from 'node:assert/strict';
import {createCpuAutonomousRepairer} from '../src/autonomous-repair-model-adapter.mjs';

const sha='a'.repeat(40);
const original='export const arithmeticFailure = 1 + 2;';
const plan={objective:'Repair arithmeticFailure regression from failing tests',
 allowedPaths:['src/math.mjs'],maxAttempts:3};
test('bounded CPU model receives sanitized failed-test data and emits one syntax-preflighted patch',async()=>{
 const urls=[],messages=[];
 const worker=createCpuAutonomousRepairer({
  get:async url=>{urls.push(url);return {sha,encoding:'base64',
    content:Buffer.from(original+'\n').toString('base64')};},
  model:async args=>{messages.push(args);
   return JSON.stringify({changes:[{path:'src/math.mjs',before:original,
    after:'export const arithmeticFailure = 1 + 3;'}]});
  }
 });
 const manifest=await worker.propose({plan,headSha:sha,attempt:2,
   previousFailure:'FAIL src/math.mjs assertion expected four'});
 assert.equal(manifest.baseSha,sha);
 assert.equal(manifest.changes.length,1);
 assert.equal(manifest.changes[0].path,'src/math.mjs');
 assert.deepEqual(urls,['/repos/Ultron-MW/Ultron.MW/contents/src/math.mjs?ref='+sha]);
 assert.match(messages[0][1].content,/FAIL src\/math.mjs/);
 assert.match(messages[0][0].content,/untrusted text/);
});
test('untrusted model cannot pivot path or inject syntactically broken code',async()=>{
 const get=async()=>({sha,encoding:'base64',
   content:Buffer.from(original+'\n').toString('base64')});
 const wrong=createCpuAutonomousRepairer({get,
  model:async()=>JSON.stringify({changes:[{path:'.github/workflows/verify.yml',
   before:original,after:'hello'}]})});
 await assert.rejects(wrong.propose({plan,headSha:sha,attempt:1}),/invalid|unscoped|not supply/i);
 const invalid=createCpuAutonomousRepairer({get,
  model:async()=>JSON.stringify({changes:[{path:'src/math.mjs',
   before:original,after:'export const arithmeticFailure = ;'}]})});
 await assert.rejects(invalid.propose({plan,headSha:sha,attempt:1}),/syntax preflight/);
});
test('rejects missing exact SHA and oversized diagnostic before any model invocation',async()=>{
 let called=0;
 const worker=createCpuAutonomousRepairer({get:async()=>{called++;return null;},
  model:async()=>{called++;return ''; }});
 await assert.rejects(worker.propose({plan,headSha:'not-a-sha',attempt:1}),/invalid/);
 await assert.rejects(worker.propose({plan,headSha:sha,attempt:1,
   previousFailure:'x'.repeat(1501)}),/invalid/);
 assert.equal(called,0);
});
