import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRepairOutput,inspectRepairOutput,scoreProposedRepair}
 from '../src/hf-heldout-eval.mjs';
import {HELDOUT_REPAIR_CASES} from '../src/hf-heldout-cases.mjs';

const item=HELDOUT_REPAIR_CASES[0];
const code=item.reference;

test('HF-FMT-01: exact and single Markdown fenced functions have identical verified behavior',()=>{
 for(const raw of [code,'```js\n'+code+'\n```','```javascript\n'+code+'\n```']){
  const out=normalizeRepairOutput(raw);
  assert.equal(out.code,code);
  assert.ok(['exact','fenced'].includes(out.format));
  assert.equal(scoreProposedRepair(item,raw).passed,true);
 }
});

test('HF-FMT-02: limited prose introduction plus single complete function can be normalized',()=>{
 for(const raw of ['Here is the corrected function:\n'+code,
   'Corrected function:\n```js\n'+code+'\n```']){
  const out=normalizeRepairOutput(raw);
  assert.equal(out.code,code);
  assert.equal(out.format,'prefaced');
  assert.equal(scoreProposedRepair(item,raw).passed,true);
 }
});

test('HF-FMT-03: multiple function declarations and executable trailers fail closed',()=>{
 const bad=[
  code+'\nfunction other(input) { return true; }',
  code+'\nprocess.exit(0);',
  'function fix(input) { return true; }\nfunction fix(input) { return false; }',
  'process.exit(0);\n'+code,
  'Here is the function; process.exit(0);\n'+code,
  '```js\n'+code+'\n```\nconst privileged = true;',
 ];
 for(const raw of bad){
  assert.equal(normalizeRepairOutput(raw).code,null,raw);
  assert.equal(scoreProposedRepair(item,raw).passed,false);
 }
});

test('HF-FMT-04: diagnostics distinguish missing signature, incomplete generation and ambiguous shape',()=>{
 assert.equal(inspectRepairOutput('return true;').shape,'missing-signature');
 assert.equal(inspectRepairOutput('function fix(input) { return true;').shape,'incomplete-function');
 assert.equal(inspectRepairOutput(code+'\nconsole.log(1)').shape,'trailing-content');
 assert.equal(inspectRepairOutput(code+'\nfunction other() {}').shape,'multiple-functions');
 assert.equal(inspectRepairOutput(code).shape,'exact');
});

test('HF-FMT-05: function scanner handles string braces without early termination',()=>{
 const source='function fix(input) {\n  const marker = "}";\n  if (input.ok) return true;\n  return false;\n}';
 assert.equal(normalizeRepairOutput(source).code,source);
 assert.equal(inspectRepairOutput(source).shape,'exact');
});

test('HF-FMT-06: format diagnostics are bounded metadata, never contain raw model output',()=>{
 const marker='secret-not-for-logs-12345';
 const result=inspectRepairOutput(marker);
 assert.equal(result.shape,'missing-signature');
 assert.equal(result.responseChars,marker.length);
 assert.ok(JSON.stringify(result).indexOf(marker)<0);
 assert.equal(normalizeRepairOutput('').code,null);
 assert.equal(normalizeRepairOutput(null).code,null);
 assert.equal(normalizeRepairOutput('x'.repeat(4000)).code,null);
});


test('HF-FMT-07: benchmark records shape-only diagnostics beside original receipts',async()=>{
 const {readFile}=await import('node:fs/promises');
 const script=await readFile(new URL('../scripts/hf-heldout-cpu.mjs',import.meta.url),'utf8');
 assert.match(script,/inspectRepairOutput/);
 assert.match(script,/hf\.repair-output-shapes\.v1/);
 assert.match(script,/-shapes\.json/);
 assert.doesNotMatch(script,/console\.log\s*\(\s*(?:response|raw|generated)\s*\)/);
});

test('HF-FMT-08: diagnostics report exact UTF-8 byte size without emitting source text',()=>{
 const raw='π🙂';
 const result=inspectRepairOutput(raw);
 assert.equal(result.responseChars,3);
 assert.equal(result.responseBytes,6);
 assert.equal(result.shape,'missing-signature');
 assert.ok(!JSON.stringify(result).includes(raw));
 assert.equal(inspectRepairOutput(null).responseBytes,0);
});
