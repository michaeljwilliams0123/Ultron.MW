import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const report=readFileSync(new URL('./fixed-comparison.test.mjs',import.meta.url),'utf8');
const record=readFileSync(new URL('../docs/verification/ISSUE68-REVIEW-PROXY-2026-10-25.md',import.meta.url),'utf8');
const words=['zero','one','two','three','four','five','six','seven','eight','nine',
 'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen',
 'eighteen','nineteen','twenty'];

test('review-proxy documentation matches the checked-in fixed-comparison baseline',()=>{
 const total=report.match(/assert\.equal\(report\.summary\.total,\s*(\d+)\)/);
 const baseline=report.match(/assert\.equal\(report\.summary\.baselinePassed,\s*(\d+)\)/);
 assert.ok(total&&baseline,'Benchmark must expose explicit total and baseline assertions');
 const missing=Number(total[1])-Number(baseline[1]);
 assert.ok(missing>=0&&missing<words.length,'Expand word mapping for benchmark growth');
 assert.match(record,new RegExp('\\b'+words[missing]+' missing-capability failures\\b'),
  'Document the actual number of baseline missing-capability failures');
 assert.match(record,/heldOutCertified:false/);
 assert.match(record,/eligibleForProtectedPromotion:false/);
});
