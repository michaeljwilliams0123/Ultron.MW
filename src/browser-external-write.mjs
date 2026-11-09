/** Owner-origin cloud-browser writes. A DOM mutation alone is never sufficient. */
export const BROWSER_WRITE_ISSUE_MARKER='ULTRON_BROWSER_WRITE_V1';
export const BROWSER_WRITE_URL='https://ultron-mw-cloud.hatchable.site/browser-write-acceptance.html';
const SOURCE=/^[a-f0-9]{40}$/;
const OBJECTIVE=/^[A-Za-z0-9._:-]{10,80}$/;
const MARKER=/^[A-Za-z][A-Za-z0-9_-]{3,79}$/;
function exactKeys(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
export function parseBrowserWritePlan(params,sourceSha,objectiveId){
 if(!exactKeys(params,['url','marker'])||params.url!==BROWSER_WRITE_URL)
  throw Error('browser-write-origin-denied');
 if(!SOURCE.test(sourceSha||'')||!OBJECTIVE.test(objectiveId||''))
  throw Error('browser-write-identity-invalid');
 if(typeof params.marker!=='string'||!MARKER.test(params.marker)||
   /(?:password|secret|token|private|passcode|apikey)/i.test(params.marker))
  throw Error('browser-write-marker-invalid');
 return Object.freeze({url:BROWSER_WRITE_URL,origin:new URL(BROWSER_WRITE_URL).origin,
  sourceSha,objectiveId,marker:params.marker});
}
export async function executeBrowserExternalWrite(plan,driver){
 if(!driver||typeof driver.perform!=='function'||typeof driver.readback!=='function')
  return {ok:false,externalWriteVerified:false,reason:'browser-write-driver-unavailable'};
 try{
  const dom=await driver.perform(plan);
  if(dom?.domChanged!==true||dom.origin!==plan.origin||
     dom.domText!=='Persisted: '+plan.marker)
   return {ok:false,externalWriteVerified:false,reason:'browser-write-ui-unverified'};
  // A second, authenticated server-side read of durable storage.
  const receipt=await driver.readback(plan);
  const ok=receipt?.ok===true&&receipt.phase==='readback'&&
    Number.isSafeInteger(receipt.receiptId)&&receipt.receiptId>0&&
    receipt.actor==='michaeljwilliams0123'&&
    receipt.objectiveId===plan.objectiveId&&receipt.marker===plan.marker&&
    receipt.sourceSha===plan.sourceSha&&receipt.effectCount===1;
  return {ok,externalWriteVerified:ok,receiptId:ok?receipt.receiptId:null,
   sourceSha:plan.sourceSha,objectiveId:plan.objectiveId,
   paidCents:0,actor:ok?receipt.actor:null,
   evidence:ok?'signed-worker-and-independent-postgresql-readback':'browser-write-readback-mismatch',
   ...(ok?{}:{reason:'browser-write-readback-unverified'})};
 }catch(error){
  return {ok:false,externalWriteVerified:false,
   reason:'browser-write-reconcile-required',uncertain:true,
   detail:String(error?.message||error).slice(0,120)};
 }
}
export function unwrapBrowserWriteIssue(raw,issueNumber){
 if(typeof raw!=='string'||raw.length>6000||
    !raw.startsWith(BROWSER_WRITE_ISSUE_MARKER+'\n')||
    !Number.isSafeInteger(issueNumber)||issueNumber<1)
  throw Error('browser-write-issue-invalid');
 let request;
 try{request=JSON.parse(raw.slice(BROWSER_WRITE_ISSUE_MARKER.length+1));}
 catch{throw Error('browser-write-issue-invalid');}
 if(!request||typeof request!=='object'||Array.isArray(request)||
   request.op!=='browser.external-write'||request.issueNumber!==undefined)
  throw Error('browser-write-issue-operation-denied');
 return {...request,issueNumber};
}
