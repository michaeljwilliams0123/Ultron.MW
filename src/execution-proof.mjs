/** Classifies durable effects without conflating source, DOM or provider evidence. */
const SHA=/^[a-f0-9]{40}$/;
const PR=/^https:\/\/github\.com\/michaeljwilliams0123\/Ultron\.MW\/pull\/[1-9][0-9]*$/;
export function classifyExecutionProof(evidence){
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))return {state:'unverified',reason:'evidence-missing'};
 if(evidence.paidCents!==0)return {state:'held',reason:'paid-budget-not-proven-zero'};
 if(evidence.kind==='github.code.pr'){
  const ok=PR.test(evidence.url||'')&&SHA.test(evidence.headSha||'')&&
   evidence.checksSha===evidence.headSha&&evidence.checksConclusion==='success'&&
   evidence.independentReadback===true;
  return ok?{state:'verified-external',reason:'exact-pr-head-and-ci-readback'}:
   {state:'unverified',reason:'github-pr-or-ci-not-confirmed'};
 }
 if(evidence.kind==='browser.action'){
  const observed=evidence.domChanged===true&&evidence.domRereadMatches===true&&
   evidence.isolatedContext===true;
  return observed?{state:'dom-verified-only',reason:'no-durable-external-effect'}:
   {state:'unverified',reason:'browser-postcondition-not-proven'};
 }
 if(evidence.kind==='browser.external-write'){
  return evidence.authorized===true&&evidence.providerWriteConfirmed===true&&
   evidence.independentReadback===true&&typeof evidence.providerReceiptId==='string'&&
   evidence.providerReceiptId.length>5?
   {state:'verified-external',reason:'authorized-provider-write-and-readback'}:
   {state:'unverified',reason:'external-write-not-confirmed'};
 }
 return {state:'unverified',reason:'unknown-operation'};
}
