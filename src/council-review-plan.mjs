/**
 * Trusted-main Council action payload. No model may create arbitrary actions.
 * One authenticated Coordinator App publishes one concrete, non-blocking
 * Skeptic review per exact PR head, only when actual diff evidence exists.
 */
const SHA=/^[a-f0-9]{40}$/;
const clip=(x,n=260)=>String(x||'').replace(/[\r\n\t]+/g,' ').slice(0,n);
const tick=String.fromCharCode(96);
export function buildCouncilReviewText({prNumber,sourceSha,prContext,modelReview}={}){
 if(!Number.isSafeInteger(prNumber)||prNumber<1||!SHA.test(sourceSha||'')||
   prContext?.schema!=='ultron.council-pr-context.v1'||
   prContext.prNumber!==prNumber||prContext.sourceSha!==sourceSha||
   !Array.isArray(prContext.files)||prContext.files.length===0)return null;
 const skeptic=modelReview?.results?.Skeptic;
 if(skeptic?.source!=='model'||!Array.isArray(skeptic.tests)||
   skeptic.tests.length<1)return null;
 const paths=prContext.files.slice(0,8).map(f=>'- '+tick+clip(f.path,180)+tick+' ('+clip(f.tag,25)+')');
 const tests=skeptic.tests.slice(0,3).map(t=>'- '+clip(t,220));
 const findings=(skeptic.findings||[]).slice(0,3).map(f=>'- '+clip(f,260));
 return[
  '**Council Skeptic — evidence-backed PR review**',
  'Exact source: '+tick+sourceSha+tick+' · PR #'+prNumber,
  '',
  '**Observed changed paths** ('+prContext.filesRendered+'/'+prContext.filesObserved+
   ', coverage '+(prContext.complete?'complete':'partial')+'):',
  ...paths,'',
  '**Model hypotheses (not verified bugs)**',...(findings.length?findings:['- None asserted']),
  '',
  '**Falsifying regression tests proposed**',...tests,
  '',
  'Provenance: '+clip(skeptic.provider,40)+' free-tier model. One authenticated GitHub App '+
  '('+tick+'ultron-coordinator'+tick+') executes this as the Skeptic logical role.',
  'This is **one single shared Coordinator App**, not an independent reviewer. '+
  'This COMMENT review does not approve or block a merge. Verify check outcomes separately.'
 ].join('\n').slice(0,3500);
}
