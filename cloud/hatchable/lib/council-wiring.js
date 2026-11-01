// Hatchable V8-compatible Council readiness contract.
// No Node built-ins, credentials, external writes, or unreviewed deployment.
const roles=Object.freeze([
 'Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'
]);
const required=Object.freeze([
 'brain_tasks','brain_events','brain_runtime_control','brain_signed_inbox',
 'capability_attempts','mahoraga_actions','brain_continuum_outbox',
 'brain_continuum_receipts','brain_council_cases','brain_council_assessments'
]);
export const COUNCIL_ROLES=roles;
export const COUNCIL_TABLES=required;
export function assessCouncilWiring({tables,installationObservations=[],sourceSha=null}={}){
 if(!Array.isArray(tables)||tables.some(t=>typeof t!=='string')||
   !Array.isArray(installationObservations)||
   (sourceSha!==null&&!(typeof sourceSha==='string'&&/^[a-f0-9]{40}$/.test(sourceSha))))
  throw Error('council-wiring-observation-invalid');
 const found=new Set(tables);
 const missing=required.filter(t=>!found.has(t));
 const appRoles=new Set();
 for(const item of installationObservations){
  if(!item||!roles.includes(item.role)||
    item.source!=='github-installations-api'||
    !Number.isSafeInteger(item.appId)||item.appId<1||
    !Number.isSafeInteger(item.installationId)||item.installationId<1||
    item.repositoryUltronVerified!==true||
    item.repositoryMahoragaVerified!==true)
   throw Error('council-wiring-installation-invalid');
  if(appRoles.has(item.role))throw Error('council-wiring-duplicate-role');
  appRoles.add(item.role);
 }
 const rolesUnverified=roles.filter(r=>!appRoles.has(r));
 // Installation metadata alone never proves a worker is authenticated.
 const missingProduction=Object.freeze([
  ...missing.map(t=>'missing-table:'+t),
  ...rolesUnverified.map(r=>'app-installation-unverified:'+r),
  'independent-executor-unverified',
  'web-egress-adapter-unverified',
  'mahoraga-receipt-unverified',
  'live-release-review-unverified'
 ]);
 return Object.freeze({
  schema:'ultron.council.wiring-readiness.v1',
  canonicalStateOwner:'Hatchable/PostgreSQL',
  sourceSha,readOnly:true,roleCount:roles.length,
  identicalCapabilityProfile:'collaborative-sme',
  githubRoleInstallationsObserved:appRoles.size,
  roleIdentities:Object.freeze([...appRoles].sort()),
  rolesUnverified:Object.freeze(rolesUnverified),
  tablesPresent:Object.freeze(required.filter(t=>found.has(t))),
  missingTables:Object.freeze(missing),
  missingProduction,
  readyForProduction:false,
  paidExternalSpendCeilingUSD:0,
  releaseApproved:false
 });
}
