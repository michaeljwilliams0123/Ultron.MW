/** C04: declarative, unprivileged GitHub App identity blueprints.
 * These values cannot register Apps, create users, authenticate a bot,
 * or establish independent review. Only live GitHub API responses can
 * substantiate installation; credentials require separately approved setup.
 */
export const COUNCIL_APP_ROLES=Object.freeze([
 'Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'
]);
const ROLE_SET=new Set(COUNCIL_APP_ROLES);
const REPO='michaeljwilliams0123/Ultron.MW';
const GITHUB_REPO=/^[a-z\d_.-]+\/[a-z\d_.-]+$/i;
const APP_PROFILE={
 scoped:Object.freeze({
   metadata:'read',contents:'read',issues:'write',
   pull_requests:'write',checks:'read',actions:'read'
 }),
 'owner-requested':Object.freeze({
   metadata:'read',administration:'write',actions:'write',
   contents:'write',workflows:'write',issues:'write',
   pull_requests:'write',checks:'write'
 })
};
function roleCheck(role){
 if(!ROLE_SET.has(role))throw Error('council-role-invalid');
}
function repoCheck(repository){
 if(typeof repository!=='string'||!GITHUB_REPO.test(repository))
  throw Error('council-repository-invalid');
}
function urlCheck(value){
 let u;
 try{u=new URL(value);}catch{throw Error('council-url-invalid');}
 if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.hash)
  throw Error('council-url-invalid');
 return u.href;
}
export function councilAlias(mailbox,role){
 roleCheck(role);
 if(typeof mailbox!=='string'||!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(mailbox))
  throw Error('council-mailbox-invalid');
 const [local,domain]=mailbox.split('@');
 const canonical=local.split('+')[0];
 if(!canonical)throw Error('council-mailbox-invalid');
 return canonical+'+'+role+'@'+domain;
}
export function buildCouncilAppManifest(role,{
 repository=REPO,webhookUrl,profile='scoped'
}={}){
 roleCheck(role);
 repoCheck(repository);
 if(!Object.hasOwn(APP_PROFILE,profile))throw Error('council-profile-invalid');
 const hookUrl=urlCheck(webhookUrl);
 return Object.freeze({
  name:'ultron-mw-'+role.toLowerCase(),
  url:'https://github.com/'+repository,
  description:'Ultron Continuum '+role+' · separately authenticated advisory agent; no implicit owner-equivalent rights',
  public:false,
  hook_attributes:Object.freeze({url:hookUrl,active:false}),
  default_events:Object.freeze([]),
  default_permissions:Object.freeze({...APP_PROFILE[profile]})
 });
}
export function validateInstallationObservation({role,repository=REPO}={},observation){
 roleCheck(role);
 repoCheck(repository);
 if(observation===null||observation===undefined)return Object.freeze({
  role,state:'unregistered',authenticated:false,canReview:false
 });
 if(!observation||observation.source!=='github-installations-api'||
   !Number.isSafeInteger(observation.app_id)||observation.app_id<1||
   !Number.isSafeInteger(observation.id)||observation.id<1||
   observation.app_slug!=='ultron-mw-'+role.toLowerCase())
   throw Error('council-identity-mismatch');
 if(observation.suspended_at)throw Error('council-installation-suspended');
 if(!Array.isArray(observation.repositories)||!observation.repositories.includes(repository))
   throw Error('council-repository-not-installed');
 const required=APP_PROFILE.scoped;
 if(!observation.permissions||Object.entries(required).some(([key,value])=>{
  const found=observation.permissions[key];
  return value==='read'?!['read','write'].includes(found):found!=='write';
 }))throw Error('council-permission-missing');
 // Installations API metadata is not a per-request token attestation.
 // Even correct app IDs and scopes are not proof a worker actually signed in.
 return Object.freeze({
  role,state:'installed-observed',authenticated:false,canReview:false,
  appId:observation.app_id,installationId:observation.id,repository
 });
}
export function decideCouncilAction(actor,{operation,repository=REPO}={}){
 if(!actor||!ROLE_SET.has(actor.role)||actor.verifiedBy!=='github-installation-token'||
   !Number.isSafeInteger(actor.installationId)||actor.installationId<1||
   typeof actor.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(actor.sourceSha)||
   actor.scope!==REPO||repository!==REPO)
  return Object.freeze({allowed:false,reason:'identity-or-scope-unverified'});
 // Read and evidence-only interactions; none of the following are authority
 // to perform a protected merge, cast a self-review, grant admin or spend.
 if(!new Set(['inspect','comment','propose']).has(operation))
  return Object.freeze({allowed:false,reason:'requires-separate-owner-and-review-authorization'});
 return Object.freeze({allowed:true,scope:repository,role:actor.role,reason:'scoped-operation'});
}
export function councilCapacityReport({installedAppCount=0,rateLimits=[]}={}){
 if(!Number.isSafeInteger(installedAppCount)||installedAppCount<0||installedAppCount>100||
   !Array.isArray(rateLimits)||rateLimits.length>100||
   rateLimits.some(n=>!Number.isSafeInteger(n)||n<0))
  throw Error('council-capacity-input-invalid');
 return Object.freeze({
  registeredAppCountClaimed:installedAppCount,
  apiBucketsObserved:rateLimits.length,
  apiRateBudgetNotTransferable:true,
  actionsBilledToRepositoryOwner:true,
  additionalAIModelTokens:0,
  additionalActionsMinutes:0,
  paidInferenceCeilingUSD:0,
  independentReasoningWithoutExecutor:false
 });
}
