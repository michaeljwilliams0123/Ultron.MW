import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyExecutionProof} from '../src/execution-proof.mjs';
const sha='a'.repeat(40);
test('real PR and exact-head CI are needed for an external execution receipt',()=>{
 const p={kind:'github.code.pr',paidCents:0,url:'https://github.com/michaeljwilliams0123/Ultron.MW/pull/329',headSha:sha,checksSha:sha,checksConclusion:'success',independentReadback:true};
 assert.equal(classifyExecutionProof(p).state,'verified-external');
 for(const changes of [{checksSha:'b'.repeat(40)},{checksConclusion:'pending'},{independentReadback:false},{url:'https://evil.invalid/pull/329'}])
  assert.equal(classifyExecutionProof({...p,...changes}).state,'unverified');
});
test('browser DOM changes do not masquerade as externally persisted effects',()=>{
 const p={kind:'browser.action',paidCents:0,domChanged:true,domRereadMatches:true,isolatedContext:true};
 assert.equal(classifyExecutionProof(p).state,'dom-verified-only');
 assert.equal(classifyExecutionProof({...p,domRereadMatches:false}).state,'unverified');
 assert.equal(classifyExecutionProof({...p,paidCents:1}).state,'held');
 assert.equal(classifyExecutionProof({...p,paidCents:undefined}).state,'held');
});
test('external browser write requires owner authority and provider readback',()=>{
 const p={kind:'browser.external-write',paidCents:0,authorized:true,providerWriteConfirmed:true,independentReadback:true,providerReceiptId:'receipt-12345'};
 assert.equal(classifyExecutionProof(p).state,'verified-external');
 for(const change of [{authorized:false},{providerWriteConfirmed:false},{independentReadback:false},{providerReceiptId:''}])
  assert.equal(classifyExecutionProof({...p,...change}).state,'unverified');
});
