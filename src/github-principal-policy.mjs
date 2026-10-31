/**
 * One GitHub App principal, many independently admitted operation profiles.
 *
 * The App installation is identity only. Authority comes from the exact
 * operation profile, a freshly down-scoped installation token, durable stop
 * state, and (for high-impact operations) an independent one-use owner grant.
 * No caller may use the App's full installed permission set as a runtime token.
 */
export const ULTRON_REPOSITORY='michaeljwilliams0123/Ultron.MW';
export const ULTRON_REPOSITORY_ID=1424939667;
export const ULTRON_GITHUB_PRINCIPAL='ultron-github-app';

const RFC3339=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA=/^[a-f0-9]{40}$/;
const ACTOR=/^github-app:[a-z0-9][a-z0-9-]{2,70}$/;
const GRANT_ID=/^[a-z0-9][a-z0-9:_-]{7,127}$/;

const PROFILES=Object.freeze({
 'identity.read':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read'})}),
 'repair.branch.create':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',contents:'write'})}),
 'repair.branch.update':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',contents:'write'})}),
 'repair.pr.create':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',pull_requests:'write'})}),
 'repair.pr.update':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',pull_requests:'write'})}),
 'repair.pr.comment':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',issues:'write'})}),
 'checks.observe':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',checks:'read'})}),
 'actions.verify.dispatch':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',contents:'read',actions:'write'})}),
 'actions.rerun_failed':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',actions:'write'})}),
 'actions.cancel':Object.freeze({authorization:'standing',permissions:Object.freeze({metadata:'read',actions:'write'})}),
 'actions.enable':Object.freeze({authorization:'step-up',permissions:Object.freeze({metadata:'read',actions:'write'})}),
 'actions.disable':Object.freeze({authorization:'step-up',permissions:Object.freeze({metadata:'read',actions:'write'})}),
 'repository.settings.update':Object.freeze({authorization:'step-up',permissions:Object.freeze({metadata:'read',administration:'write'})}),
 'webhooks.ping':Object.freeze({authorization:'step-up',permissions:Object.freeze({metadata:'read',webhooks:'write'})}),
});

export const GITHUB_OPERATION_PROFILES=Object.freeze(Object.keys(PROFILES));

export function parseInstant(value){
 if(typeof value!=='string'||!RFC3339.test(value))return NaN;
 return Date.parse(value);
}

export function operationProfile(operation){
 if(typeof operation!=='string'||!Object.hasOwn(PROFILES,operation))
  throw Error('GitHub operation profile not admitted');
 return PROFILES[operation];
}

export function requiredTokenPermissions(operation){
 return Object.freeze({...operationProfile(operation).permissions});
}

function exactPermissions(actual,expected){
 return actual&&typeof actual==='object'&&!Array.isArray(actual)&&
  Object.keys(actual).length===Object.keys(expected).length&&
  Object.entries(expected).every(([name,value])=>actual[name]===value);
}

/**
 * Validates readback of a token minted for one exact operation. The readback
 * contains identity and effective permission metadata only, never the token.
 */
export function assertUnifiedGitHubIdentity(identity,{operation,now}={}){
 const instant=parseInstant(now),expires=parseInstant(identity?.expiresAt);
 const profile=operationProfile(operation);
 const valid=Number.isFinite(instant)&&identity&&typeof identity==='object'&&
  identity.source==='github-installation-token-readback'&&identity.verified===true&&
  identity.principal===ULTRON_GITHUB_PRINCIPAL&&
  identity.repository===ULTRON_REPOSITORY&&
  identity.repositoryId===ULTRON_REPOSITORY_ID&&
  Number.isSafeInteger(identity.installationId)&&identity.installationId>0&&
  ACTOR.test(identity.actorRef||'')&&expires>instant&&
  expires<=instant+60*60*1000&&identity.operation===operation&&
  exactPermissions(identity.permissions,profile.permissions);
 if(!valid)throw Error('Unified GitHub App identity or token profile invalid');
 return Object.freeze({
  principal:ULTRON_GITHUB_PRINCIPAL,
  actorRef:identity.actorRef,
  installationId:identity.installationId,
  repositoryId:identity.repositoryId,
  operation,
  expiresAt:new Date(expires).toISOString(),
 });
}

/**
 * Standing grants may authorize only routine profiles. High-impact profiles
 * require a separately verified owner step-up bound to the exact plan digest.
 */
export function assertOperationAuthorization(authorization,{
 operation,planDigest,idempotencyKey,installationId,now,
}={}){
 const profile=operationProfile(operation),instant=parseInstant(now);
 const expires=parseInstant(authorization?.expiresAt);
 const expectedSource=profile.authorization==='step-up'
  ?'independent-owner-authorization':'independent-standing-grant';
 const valid=Number.isFinite(instant)&&authorization&&
  authorization.verified===true&&authorization.source===expectedSource&&
  authorization.actor==='michaeljwilliams0123'&&
  authorization.repository===ULTRON_REPOSITORY&&
  authorization.operation===operation&&authorization.planDigest===planDigest&&
  authorization.idempotencyKey===idempotencyKey&&
  authorization.installationId===installationId&&
  GRANT_ID.test(authorization.grantId||'')&&expires>instant&&
  expires<=instant+10*60*1000;
 if(!valid)throw Error('GitHub operation authorization invalid or missing');
 return Object.freeze({grantId:authorization.grantId,authorization:profile.authorization,
  expiresAt:new Date(expires).toISOString()});
}

/**
 * Produces a non-executable readiness result. It never merges. A protected
 * head is ready only when exact-head required checks and an independent human
 * review were freshly read from GitHub for the same SHA.
 */
export function evaluateProtectedHead(evidence,{headSha,principalActorRef,now}={}){
 const instant=parseInstant(now),observed=parseInstant(evidence?.observedAt);
 const checks=Array.isArray(evidence?.checks)?evidence.checks:[];
 const required=new Set(['test','fixed-comparison']);
 const atHead=checks.filter(check=>check?.headSha===headSha);
 const passed=new Set([...required].filter(name=>{
  const entries=atHead.filter(check=>check?.name===name);
  return entries.length>0&&entries.every(check=>
   check.status==='completed'&&check.conclusion==='success');
 }));
 const review=evidence?.review;
 const ready=Number.isFinite(instant)&&Number.isFinite(observed)&&
  instant-observed>=0&&instant-observed<=5*60*1000&&SHA.test(headSha||'')&&
  typeof principalActorRef==='string'&&principalActorRef.length>0&&
  evidence?.source==='github-protected-head-readback'&&evidence?.verified===true&&
  evidence?.headSha===headSha&&[...required].every(name=>passed.has(name))&&
  review?.state==='approved'&&review?.headSha===headSha&&review?.independent===true&&
  typeof review.actorRef==='string'&&review.actorRef.length>0&&
  review.actorRef!==principalActorRef;
 return Object.freeze({ready,executable:false,headSha,
  reason:ready?'exact-head-checks-and-independent-review':'protected-head-evidence-incomplete'});
}
