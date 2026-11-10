/**
 * One GitHub App principal, many independently admitted operation profiles.
 *
 * The App installation is identity only. Authority comes from the exact
 * operation profile, a freshly down-scoped installation token, durable stop
 * state, and (for high-impact operations) a one-use grant issued by the owner.
 * No caller may use the App's full installed permission set as a runtime token.
 */
export const ULTRON_REPOSITORY='michaeljwilliams0123/Ultron.MW';
export const ULTRON_REPOSITORY_ID=1424939667;
export const ULTRON_GITHUB_PRINCIPAL='ultron-github-app';

const RFC3339=/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;
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
 // Date.parse normalizes nonexistent calendar dates (Feb 30 -> Mar 2).
 // An expiry or protected-head observation must use the exact stated day.
 const parts=RFC3339.exec(value);
 if(!parts)return NaN;
 const y=Number(parts[1]),m=Number(parts[2]),d=Number(parts[3]);
 // RFC3339 timezone offsets cannot exceed 14 hours; 14:00 is the limit.
 // Date.parse otherwise accepts impossible +23:59 and 24:00 notation.
 if(parts[6]!==undefined){
  const hours=Number(parts[7]),minutes=Number(parts[8]);
  if(hours>14||hours===14&&minutes!==0)return NaN;
 }
 const leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(d<1||d>(days[m-1]??0))return NaN;
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
 * require a verified owner step-up bound to the exact plan digest.
 */
export function assertOperationAuthorization(authorization,{
 operation,planDigest,idempotencyKey,installationId,now,
}={}){
 const profile=operationProfile(operation),instant=parseInstant(now);
 const expires=parseInstant(authorization?.expiresAt);
 const expectedSource=profile.authorization==='step-up'
  ?'owner-step-up-authorization':'owner-standing-authorization';
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
 * Non-executable source-merge readiness assessment. Owner approval is the
 * authority for routine PRs; a second reviewer is not a universal Ultron gate.
 * This function MUST receive verified observations from trusted GitHub/owner
 * readers, not a model, candidate worker, or caller-supplied assertion. GitHub
 * branch protection and material security/dependency holds remain separate.
 * Issue #209 contains the owner-approved queue; PR #200 requires technical
 * security evaluation (#201), not a second human signer. #198 remains parked.
 */
export function evaluateProtectedHead(evidence,{headSha,principalActorRef,prNumber,now}={}){
 const instant=parseInstant(now),observed=parseInstant(evidence?.observedAt);
 const checks=Array.isArray(evidence?.checks)?evidence.checks:[];
 const required=new Set(['test','fixed-comparison']);
 const atHead=checks.filter(check=>check?.headSha===headSha);
 const passed=new Set([...required].filter(name=>{
  const entries=atHead.filter(check=>check?.name===name);
  return entries.length>0&&entries.every(check=>
   check.status==='completed'&&check.conclusion==='success');
 }));
 const owner=evidence?.ownerApproval;
 const ownerApproved=Number.isSafeInteger(prNumber)&&prNumber>0&&
  owner?.source==='github-owner-queue-attestation'&&owner?.verified===true&&
  owner?.actor==='michaeljwilliams0123'&&
  owner?.repository===ULTRON_REPOSITORY&&
  owner?.issueNumber===209&&
  Number.isSafeInteger(owner?.commentId)&&owner.commentId>0&&
  owner?.scope==='routine-source-squash'&&owner?.decision==='approved'&&
  Array.isArray(owner?.approvedPrNumbers)&&
  owner.approvedPrNumbers.every(n=>Number.isSafeInteger(n)&&n>0)&&
  owner.approvedPrNumbers.includes(prNumber);
 const rules=evidence?.githubRules;
 const githubEligible=rules?.source==='github-enforced-merge-readback'&&
  rules?.verified===true&&rules?.eligible===true;
 const securityReady=evidence?.dependenciesSatisfied===true&&
  evidence?.materialSecurityFindingsClear===true&&
  // Critical security findings require machine-verifiable evaluation evidence,
  // not a separate human approver. Owner approval alone does not fabricate it.
  (prNumber!==200&&evidence?.criticalSecurityHold!==true||
   evidence?.securityEvaluation?.source==='trusted-automated-security-evaluation'&&
   evidence?.securityEvaluation?.verified===true&&
   evidence?.securityEvaluation?.status==='cleared')&&
  // #198 proposes a separate Admin App inconsistent with the single principal.
  prNumber!==198;
 const ready=Number.isFinite(instant)&&Number.isFinite(observed)&&
  instant-observed>=0&&instant-observed<=5*60*1000&&SHA.test(headSha||'')&&
  typeof principalActorRef==='string'&&principalActorRef.length>0&&
  evidence?.source==='github-protected-head-readback'&&evidence?.verified===true&&
  evidence?.headSha===headSha&&[...required].every(name=>passed.has(name))&&
  ownerApproved&&githubEligible&&securityReady;
 return Object.freeze({ready,executable:false,headSha,
  reason:ready?'exact-head-checks-and-owner-authorization':'protected-head-evidence-incomplete'});
}
