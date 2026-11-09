import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBrowserWritePlan,executeBrowserExternalWrite,unwrapBrowserWriteIssue,
  BROWSER_WRITE_ISSUE_MARKER} from '../src/browser-external-write.mjs';
import {parseWorkerRequest,runWorkerOperation,toLedgerResult} from '../src/council-worker.mjs';

const SHA='a'.repeat(40);
const request=()=>({objectiveId:'browser-persisted-acceptance-20261109a',
  sourceSha:SHA,op:'browser.external-write',role:'Builder',
  params:{url:'https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html',
   marker:'Ultron-Cloud-External-001'}});

test('owner-gated browser write is fixed to Ultron source, origin and harmless marker',()=>{
 const r=parseWorkerRequest(request());
 assert.equal(r.op,'browser.external-write');
 assert.equal(r.sourceSha,SHA);
 const plan=parseBrowserWritePlan(r.params,r.sourceSha,r.objectiveId);
 assert.equal(plan.origin,'https://ultron-mw-cloud.hatchable.site');
 assert.equal(plan.marker,'Ultron-Cloud-External-001');
 for(const patch of [{url:'https://github.com/'},{url:'http://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html'},
  {url:'https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html#secret'},
  {marker:'password=example'},{marker:'not valid with spaces'},
  {url:'https://ultron-mw-cloud.hatchable.site/execution-canary.html'}]){
  assert.throws(()=>parseWorkerRequest({...request(),params:{...request().params,...patch}}),
   /browser-write-/);
 }
});

test('a UI click is insufficient until second authenticated database readback confirms one external effect',async()=>{
 const plan=parseBrowserWritePlan(request().params,SHA,request().objectiveId);
 const calls=[];
 const driver={perform:async p=>{calls.push('browser-perform');return {
    domChanged:true,domText:'Persisted: '+p.marker,origin:p.origin};},
  readback:async p=>{calls.push('independent-readback');return {
    ok:true,phase:'readback',receiptId:2002,actor:'michaeljwilliams0123',
    objectiveId:p.objectiveId,marker:p.marker,sourceSha:p.sourceSha,effectCount:1};}};
 const observed=await executeBrowserExternalWrite(plan,driver);
 assert.equal(observed.ok,true);
 assert.equal(observed.receiptId,2002);
 assert.deepEqual(calls,['browser-perform','independent-readback']);
 const worker=await runWorkerOperation(parseWorkerRequest(request()),{browser:{externalWrite:async()=>observed}});
 assert.equal(worker.status,'verified');
 assert.equal(toLedgerResult(worker).status,'done');
 assert.equal(toLedgerResult(worker).effect.externalWriteVerified,true);
});

test('a forged DOM success or mismatched persisted readback cannot count as authenticated external completion',async()=>{
 const plan=parseBrowserWritePlan(request().params,SHA,request().objectiveId);
 const good={ok:true,phase:'readback',receiptId:2002,
   actor:'michaeljwilliams0123',objectiveId:plan.objectiveId,marker:plan.marker,
   sourceSha:plan.sourceSha,effectCount:1};
 for(const altered of [
  {...good,actor:'github-actions[bot]'}, {...good,sourceSha:'b'.repeat(40)},
  {...good,marker:'wrong'}, {...good,effectCount:2}, {...good,receiptId:null},null]){
  const result=await executeBrowserExternalWrite(plan,{
   perform:async()=>({domChanged:true,domText:'Persisted: '+plan.marker,origin:plan.origin}),
   readback:async()=>altered});
  assert.equal(result.ok,false);
  assert.equal(result.externalWriteVerified,false);
 }
 const domOnly=await executeBrowserExternalWrite(plan,{
  perform:async()=>({domChanged:true,domText:'Persisted: '+plan.marker,origin:plan.origin}),
  readback:async()=>{throw Error('provider-not-reachable');}});
 assert.equal(domOnly.ok,false);
});

test('only owner-created issue marker can invoke this fixed browser write operation',()=>{
 const body=BROWSER_WRITE_ISSUE_MARKER+'\n'+JSON.stringify(request());
 const parsed=unwrapBrowserWriteIssue(body,346);
 assert.equal(parsed.issueNumber,346);
 assert.equal(parseWorkerRequest(parsed).op,'browser.external-write');
 assert.throws(()=>unwrapBrowserWriteIssue(body.replace('browser.external-write','shell.exec'),346),
   /browser-write-/);
 assert.throws(()=>unwrapBrowserWriteIssue(body.replace(BROWSER_WRITE_ISSUE_MARKER,'OTHER'),346),
   /browser-write-/);
});
