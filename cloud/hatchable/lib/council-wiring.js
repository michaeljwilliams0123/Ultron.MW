// Hatchable V8-compatible Council readiness contract.
// No Node built-ins, credentials, external writes, or unreviewed deployment.
const roles=Object.freeze([
 'Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'
]);
const required=Object.freeze([
 'brain_tasks','brain_events','brain_runtime_control','brain_signed_inbox',
 'capability_attempts','mahoraga_actions','brain_continuum_outbox',
 'brain_continuum_receipts','brain_council_cases','brain_council_assessments',
 'brain_council_executions','brain_council_execution_events'
]);
export const COUNCIL_ROLES=roles;
const MANIFEST_SPECS=Object.freeze([
 Object.freeze({id:'github',surface:'connector'}),
 Object.freeze({id:'mahoraga',surface:'connector'}),
 Object.freeze({id:'desktop-commander',surface:'connector'}),
 Object.freeze({id:'descope',surface:'connector'}),
 Object.freeze({id:'hugging-face',surface:'connector'}),
 Object.freeze({id:'browser-use',surface:'connector'}),
 Object.freeze({id:'compound-engineering',surface:'skill'}),
 Object.freeze({id:'caveman',surface:'skill'})
]);
const MANIFEST_STATES=new Set(['connected','ready','blocked']);
export const COUNCIL_MANIFESTS=MANIFEST_SPECS;
export function assessManifestStates(manifestObservations=[]){
 if(!Array.isArray(manifestObservations))throw Error('council-wiring-manifest-invalid');
 const byId=new Map();
 for(const item of manifestObservations){
  if(!item||typeof item.id!=='string'||!MANIFEST_STATES.has(item.state)||byId.has(item.id))
   throw Error('council-wiring-manifest-invalid');
  byId.set(item.id,item);
 }
 return Object.freeze(MANIFEST_SPECS.map(spec=>{
  const obs=byId.get(spec.id);
  if(spec.surface==='skill'){
   if(obs&&obs.state!=='blocked')throw Error('council-wiring-manifest-invalid');
   return Object.freeze({id:spec.id,surface:spec.surface,state:'blocked',
    reason:obs?.reason||'skill-only-no-execution-adapter'});
  }
  if(!obs)return Object.freeze({id:spec.id,surface:spec.surface,state:'blocked',
   reason:'no-authenticated-runtime-observation'});
  return Object.freeze({id:spec.id,surface:spec.surface,state:obs.state,
   reason:typeof obs.reason==='string'&&obs.reason?obs.reason:'observed'});
 }));
}
export const COUNCIL_TABLES=required;
const RUNTIME_IDS=Object.freeze([
 'repo.inspect','repo.prs','repo.ci','site.render','council.review','council.room',
 'research.intake'
]);
const CANDIDATE_IDS=Object.freeze([
 'web.open','mahoraga.repo.inspect','mahoraga.task.prepare'
]);
export function assessCouncilWiring({
 tables,installationObservations=[],runtimeCapabilities=[],manifestObservations=[],sourceSha=null
}={}){
 if(!Array.isArray(tables)||tables.some(t=>typeof t!=='string')||
   !Array.isArray(installationObservations)||
   !Array.isArray(runtimeCapabilities)||
   runtimeCapabilities.length>RUNTIME_IDS.length||
   (sourceSha!==null&&!(typeof sourceSha==='string'&&/^[a-f0-9]{40}$/.test(sourceSha))))
  throw Error('council-wiring-observation-invalid');
 const seenCapabilities=new Set();
 const runtime=runtimeCapabilities.map(item=>{
  if(!item||!RUNTIME_IDS.includes(item.id)||
     !['read','advisory'].includes(item.effect)||
     seenCapabilities.has(item.id))
    throw Error('council-wiring-observation-invalid');
  seenCapabilities.add(item.id);
  return Object.freeze({id:item.id,effect:item.effect,
   status:'runtime-registered',liveAcceptanceVerified:false});
 });
 const candidate=CANDIDATE_IDS.map(id=>Object.freeze({
  id,effect:id==='mahoraga.task.prepare'?'proposal-only':'read',
  status:'source-candidate-not-deployed',liveAcceptanceVerified:false
 }));
 const capabilities=Object.freeze([...runtime,...candidate]);
 const manifests=assessManifestStates(manifestObservations);
 const found=new Set(tables);
 const missing=required.filter(t=>!found.has(t));
 const appRoles=new Set(),appIds=new Set(),installationIds=new Set();
 for(const item of installationObservations){
  if(!item||!roles.includes(item.role)||
    item.source!=='github-installations-api'||
    !Number.isSafeInteger(item.appId)||item.appId<1||
    !Number.isSafeInteger(item.installationId)||item.installationId<1||
    item.repositoryUltronVerified!==true||
    item.repositoryMahoragaVerified!==true)
   throw Error('council-wiring-installation-invalid');
  if(appRoles.has(item.role))throw Error('council-wiring-duplicate-role');
  if(appIds.has(item.appId))throw Error('council-wiring-duplicate-app');
  if(installationIds.has(item.installationId))
   throw Error('council-wiring-duplicate-installation');
  appRoles.add(item.role);
  appIds.add(item.appId);
  installationIds.add(item.installationId);
 }
 const rolesUnverified=roles.filter(r=>!appRoles.has(r));
 // Installation metadata alone never proves a worker is authenticated.
 const missingProduction=Object.freeze([
  ...missing.map(t=>'missing-table:'+t),
  // Role labels are not seven separate human/App release prerequisites.
  // Preserve their diagnostic status without fabricating identities.
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
  capabilities,
  manifestCount:manifests.length,
  manifests,
  provenance:Object.freeze({
   runtimeEvidence:'hatchable-deployed-brain-core-capabilities',
   candidateEvidence:'source-candidate-not-deployed',
   installationEvidence:'no-authenticated-installation-observations'
  }),
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
