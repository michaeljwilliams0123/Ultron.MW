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
 // Equal GitHub rights for all seven; expertise is not a permission tier.
 'collaborative-sme':Object.freeze({
   metadata:'read',contents:'write',issues:'write',
   pull_requests:'write',checks:'read',actions:'write'
 }),
 'owner-requested':Object.freeze({
   metadata:'read',administration:'write',actions:'write',
   contents:'write',workflows:'write',issues:'write',
   pull_requests:'write',checks:'write'
 })
};
const ENGINEERING_ROLE_GRANTS=Object.freeze({
 Builder:Object.freeze({contents:'write'}),
 Generator:Object.freeze({contents:'write'}),
 Sentinel:Object.freeze({actions:'write'}),
 Skeptic:Object.freeze({}),Steward:Object.freeze({}),
 Predictor:Object.freeze({}),Companion:Object.freeze({})
});
const COLLABORATIVE_OPS=Object.freeze([
 'branch.create','branch.update','pr.create','pr.comment','issue.create',
 'issue.comment','review.comment','review.request-changes','actions.dispatch',
 'web.open','mahoraga.repo.inspect','mahoraga.task.prepare'
]);
const ENGINEERING_OPS=Object.freeze({
 Builder:Object.freeze(['branch.create','branch.update','pr.create','pr.comment','issue.create','issue.comment']),
 Generator:Object.freeze(['branch.create','branch.update','pr.create','pr.comment','issue.create','issue.comment']),
 Skeptic:Object.freeze(['review.comment','review.request-changes','issue.comment','pr.comment']),
 Steward:Object.freeze(['review.comment','review.request-changes','issue.comment','pr.comment']),
 Predictor:Object.freeze(['issue.create','issue.comment','pr.comment']),
 Sentinel:Object.freeze(['actions.dispatch','issue.comment','pr.comment']),
 Companion:Object.freeze(['issue.comment','pr.comment'])
});
function profileRights(role,profile){
 if(profile==='engineering-autonomy')
  return {...APP_PROFILE.scoped,...ENGINEERING_ROLE_GRANTS[role]};
 if(!Object.hasOwn(APP_PROFILE,profile))throw Error('council-profile-invalid');
 return APP_PROFILE[profile];
}
const SAFE_BRANCH=/^ultron\/council-(builder|skeptic|steward|predictor|generator|sentinel|companion)-[a-z0-9][a-z0-9-]{2,55}$/;
const SAFE_CODE_PATH=/^(src|test|docs|scripts|cloud\/hatchable)\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/;
const BRANCH_OPERATIONS=new Set(['branch.create','branch.update','pr.create']);
const REVIEW_OPERATIONS=new Set(['review.comment','review.request-changes']);
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
 const grants=profileRights(role,profile);
 const hookUrl=urlCheck(webhookUrl);
 return Object.freeze({
  name:'ultron-mw-'+role.toLowerCase(),
  url:'https://github.com/'+repository,
  description:'Ultron Continuum '+role+' · separately authenticated advisory agent; no implicit owner-equivalent rights',
  public:false,
  hook_attributes:Object.freeze({url:hookUrl,active:false}),
  default_events:Object.freeze([]),
  default_permissions:Object.freeze({...grants})
 });
}
export function validateInstallationObservation({role,repository=REPO,profile='scoped'}={},observation){
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
 const required=profileRights(role,profile);
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
// A caller-supplied string like "verifiedBy:github-installation-token" is
// never authentication. Only this process's trusted backend probe may mint
// a branded actor; a serialized or cloned object loses its authority.
const AUTHENTICATED_ACTORS=new WeakSet();
export async function authenticateCouncilAppActor({
 role,repository=REPO,sourceSha,installationToken,githubProbe,profile='scoped'
}={}){
 roleCheck(role);
 repoCheck(repository);
 if(repository!==REPO||typeof sourceSha!=='string'||
   !/^[a-f0-9]{40}$/.test(sourceSha)||
   typeof installationToken!=='string'||installationToken.length<12||
   typeof githubProbe!=='function')
   throw Error('council-authentication-unavailable');
 // githubProbe MUST be a trusted server-side GitHub API client. Never let an
 // incoming request/body supply this function, token or installation proof.
 const observed=await githubProbe({installationToken,repository});
 const binding=validateInstallationObservation({role,repository,profile},observed);
 const actor=Object.freeze({role,installationId:binding.installationId,
   verifiedBy:'github-installation-token',scope:repository,sourceSha,profile});
 AUTHENTICATED_ACTORS.add(actor);
 return actor;
}
export function decideCouncilAction(actor,request={}){
 const {operation,repository=REPO}=request;
 if(!actor||!AUTHENTICATED_ACTORS.has(actor)||!ROLE_SET.has(actor.role)||
   actor.verifiedBy!=='github-installation-token'||
   !Number.isSafeInteger(actor.installationId)||actor.installationId<1||
   typeof actor.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(actor.sourceSha)||
   actor.scope!==REPO||repository!==REPO)
  return Object.freeze({allowed:false,reason:'identity-or-scope-unverified'});
 // Existing scoped advisory admission remains unchanged.
 if(new Set(['inspect','comment','propose']).has(operation))
  return Object.freeze({allowed:true,scope:repository,role:actor.role,reason:'scoped-operation'});
 // Elevation requires a separately installed engineering profile, a trusted
 // installation-token proof, exact source SHA, bounded attempt and zero cost.
 const allowedOps=actor.profile==='collaborative-sme'?
   COLLABORATIVE_OPS:ENGINEERING_OPS[actor.role];
 if(!['engineering-autonomy','owner-requested','collaborative-sme'].includes(actor.profile)||
   !allowedOps?.includes(operation))
  return Object.freeze({allowed:false,reason:'requires-separate-owner-and-review-authorization'});
 if(request.baseSha!==actor.sourceSha||request.maxPaidCents!==0||
   !Number.isSafeInteger(request.attempt)||request.attempt<1||request.attempt>3)
  return Object.freeze({allowed:false,reason:'scoped-plan-not-verified'});
 if(new Set(['web.open','mahoraga.repo.inspect','mahoraga.task.prepare']).has(operation)){
  if(typeof request.externalIntentFingerprint!=='string'||
     !/^[a-f0-9]{64}$/.test(request.externalIntentFingerprint)||
     typeof request.caseSha!=='string'||!/^[a-f0-9]{64}$/.test(request.caseSha))
   return Object.freeze({allowed:false,reason:'external-intent-unverified'});
  // Public-target and cross-repository checks run inside the branded
  // council-external-authority plan and the separately trusted egress worker.
  return Object.freeze({allowed:true,scope:repository,role:actor.role,
   reason:'bounded-external-operation'});
 }
 if(BRANCH_OPERATIONS.has(operation)){
  const match=typeof request.branch==='string'&&request.branch.match(SAFE_BRANCH);
  if(!match||match[1]!==actor.role.toLowerCase()||
    (operation==='branch.update'&&
      (typeof request.path!=='string'||!SAFE_CODE_PATH.test(request.path)||
       request.path.split('/').some(x=>x==='.'||x==='..')||
       request.path.includes('//')||
       request.path.startsWith('.github/'))))
   return Object.freeze({allowed:false,reason:'scope-denied'});
 }
 if(operation==='actions.dispatch'&&
   (request.workflow!=='verify.yml'||request.ref!=='main'))
  return Object.freeze({allowed:false,reason:'workflow-not-approved'});
 if(REVIEW_OPERATIONS.has(operation)&&
   (typeof request.prAuthor!=='string'||!request.prAuthor.trim()||
    request.prAuthor.toLowerCase()===
     ('ultron-mw-'+actor.role.toLowerCase()+'[bot]')))
  return Object.freeze({allowed:false,reason:'self-review-denied'});
 return Object.freeze({allowed:true,scope:repository,role:actor.role,reason:'bounded-engineering-operation'});
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
