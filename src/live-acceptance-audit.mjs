// Read-only public acceptance classification. Private app execution requires
// separately authenticated, independently observed evidence; do not infer it
// from source tests or from HTTP route availability.
export const REQUIRED_CHECKS=Object.freeze([
 {id:'github-main',label:'GitHub main revision'},
 {id:'github-verify',label:'GitHub exact-main Verify'},
 {id:'pages-http',label:'GitHub Pages HTTP'},
 {id:'pages-revision',label:'GitHub Pages revision parity'},
 {id:'pages-module',label:'GitHub Pages JavaScript module'},
 {id:'production-http',label:'Hatchable production HTTP'},
 {id:'production-admin-gate',label:'Production anonymous admin denial'},
 {id:'production-scheduler-gate',label:'Production scheduler ingress denial'}
]);
const SHA=/^[0-9a-f]{40}$/;
const REPO='https://github.com/michaeljwilliams0123/Ultron.MW';
const privateBoundary=Object.freeze({
 privateAuthenticatedReadback:'not-tested',
 externalWriteReconciliation:'not-tested',
 multiProviderDelegation:'not-tested',
 ownerBrowserExecution:'not-tested',
 crashAndResponseLossRecovery:'not-tested',
 independentLearning:'not-tested',
 gitbookSynchronization:'not-tested'
});
const clean=value=>String(value??'').replace(/[\r\n|<>]/g,' ').slice(0,200).trim();

export function parsePagesRevision(html){
 if(typeof html!=='string')return null;
 for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){
  const attrs={};
  for(const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
   attrs[m[1].toLowerCase()]=m[2]??m[3];
  if(attrs.name?.toLowerCase()==='ultron-source-sha'&&SHA.test(attrs.content||''))
   return attrs.content;
 }
 return null;
}

// A conflicting duplicate is a failure, never an opportunity to select the
// favorable claim. A missing, invalid or unproved check remains unknown.
export function evaluateAcceptance({sourceSha,observedAt,checks=[]}={}){
 const observations=Array.isArray(checks)?checks:[];
 const ordered=REQUIRED_CHECKS.map(spec=>{
  const matches=observations.filter(v=>v?.id===spec.id);
  let status='unknown';
  if(matches.length>1)status='fail';
  else if(matches.length===1&&['pass','fail','unknown'].includes(matches[0].status))
   status=matches[0].status;
  const detail=matches.length>1?'Conflicting duplicate observations':
   matches.length===1?clean(matches[0].detail):'No independently collected observation';
  return {id:spec.id,label:spec.label,status,detail};
 });
 const counts={
  passed:ordered.filter(x=>x.status==='pass').length,
  failed:ordered.filter(x=>x.status==='fail').length,
  unknown:ordered.filter(x=>x.status==='unknown').length
 };
 const publicReadiness=counts.failed?'degraded':counts.unknown?'incomplete':'observed-healthy';
 return {
  schema:'ultron.live-acceptance.v1',
  observedAt:typeof observedAt==='string'?observedAt:new Date().toISOString(),
  sourceSha:SHA.test(sourceSha||'')?sourceSha:null,
  publicReadiness,
  productionReadiness:'not-accepted',
  checks:ordered,counts,
  evidenceBoundary:{...privateBoundary},
  issueLinks:Object.fromEntries([65,66,67,68,69].map(n=>[String(n),REPO+'/issues/'+n]))
 };
}

export function renderAcceptanceMarkdown(audit){
 const lines=[
  '# Ultron live acceptance — public read-only audit','',
  '**Public readiness:** '+audit.publicReadiness,
  '**Autonomous production acceptance:** '+audit.productionReadiness,
  '**Observed at:** '+audit.observedAt,
  '**Source SHA:** '+(audit.sourceSha||'unverified'),'',
  '## GitHub Pages, GitHub Actions, and Hatchable public checks','',
  '| Surface | Result | Observation |','| --- | --- | --- |',
  ...audit.checks.map(x=>'| '+clean(x.label)+' | '+x.status+' | '+clean(x.detail)+' |'),
  '',
  '## What this workflow cannot certify','',
  'The public probes do not access private Hatchable databases, authenticated owner sessions, secret values, independent provider grants, GitBook sync or external-write postconditions. Source CI is not live owner/browser acceptance.',
  '',
  '| Contract | State | Issue |','| --- | --- | --- |',
  '| Authenticated two-provider authority and uncertain writes | not-tested | '+audit.issueLinks['67']+' |',
  '| Browser owner session and live multistep actions | not-tested | '+audit.issueLinks['65']+' |',
  '| Crash/restart and response-loss recovery | not-tested | '+audit.issueLinks['66']+' |',
  '| Independent held-out improvement | not-tested | '+audit.issueLinks['68']+' |',
  '| Route consumer parity and GitBook sync | not-tested | '+audit.issueLinks['69']+' |',
  '',
  'Do not close acceptance issues or replay uncertain writes from this report.'
 ];
 return lines.join('\n')+'\n';
}
