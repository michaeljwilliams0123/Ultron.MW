import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyC06Files,validateC06Documentation} from '../src/c06-model-origin.mjs';

const root=new URL('../',import.meta.url);
const fromRoot=path=>readFile(new URL(path,root),'utf8');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const paths=['lib/c06-model-candidate.js','test/c06-model-generated.test.mjs',
 'docs/c06-model-generated.md','evidence/c06-model-origin.json'];

test('C06 release gate: committed model source, test, docs and receipt have exact provenance',async()=>{
 const values=await Promise.all(paths.map(fromRoot));
 const files=Object.fromEntries(paths.map((p,i)=>[p,values[i]]));
 const receipt=JSON.parse(files[paths[3]]);
 assert.equal(receipt.origin,'model-inference-not-assistant-authored');
 assert.equal(receipt.productionAccepted,false);
 assert.equal(receipt.paidCents,0);
 assert.equal(verifyC06Files(files,{sourceSha:receipt.sourceSha,runId:receipt.runId}).valid,true);
});

test('C06 release gate: an inaccurate committed model doc must be explicitly quarantined',async()=>{
 const doc=await fromRoot('docs/c06-model-generated.md');
 const receipt=JSON.parse(await fromRoot('evidence/c06-model-origin.json'));
 let valid=false;
 try{valid=validateC06Documentation(doc)===doc.trim()+'\n';}catch{}
 if(valid)return;
 const quarantine=JSON.parse(await fromRoot('evidence/c06-model-candidate-quarantine.json'));
 assert.equal(quarantine.schema,'ultron.c06.release-quarantine.v1');
 assert.equal(quarantine.originReceiptDigest,receipt.receiptDigest);
 assert.equal(quarantine.generatedDocSha256,sha256(doc));
 assert.equal(quarantine.runId,receipt.runId);
 assert.equal(quarantine.productionAccepted,false);
 assert.equal(quarantine.deployAllowed,false);
 assert.equal(quarantine.reason,'invalid-technical-documentation');
});
