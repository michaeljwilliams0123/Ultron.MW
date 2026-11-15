import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCouncilReviewText} from '../src/council-review-plan.mjs';
const sha='a'.repeat(40);
const context={schema:'ultron.council-pr-context.v1',sourceSha:sha,prNumber:460,
 filesObserved:2,filesRendered:2,complete:true,files:[
  {path:'src/auth-check.mjs',tag:'security-path'},
  {path:'test/auth-check.test.mjs',tag:'test'}]};
const reasoning={results:{Skeptic:{source:'model',provider:'google',
 rationale:'A denied write may be retried.',findings:['src/auth-check.mjs: check nonce'],
 tests:['assert a second POST is never issued']}}};
test('trusted Council review writes a concrete PR-specific, advisory comment',()=>{
 const output=buildCouncilReviewText({prNumber:460,sourceSha:sha,prContext:context,modelReview:reasoning});
 assert.match(output,/src\/auth-check\.mjs/);
 assert.match(output,/second POST/);
 assert.match(output,/single shared Coordinator App/);
 assert.match(output,/does not approve or block a merge/);
});
test('no code evidence, foreign head or unsupported model is a no-op, not generic spam',()=>{
 assert.equal(buildCouncilReviewText({prNumber:460,sourceSha:sha,prContext:null,modelReview:reasoning}),null);
 assert.equal(buildCouncilReviewText({prNumber:460,sourceSha:'b'.repeat(40),prContext:context,modelReview:reasoning}),null);
 assert.equal(buildCouncilReviewText({prNumber:460,sourceSha:sha,prContext:context,modelReview:{results:{}}}),null);
});
