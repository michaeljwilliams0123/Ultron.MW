/**
 * Trusted Council 7/7 gate, v2 (rebuild of #397 after the Skeptic review).
 *
 * Runs ONLY from code checked out from default `main` by
 * .github/workflows/council-required-status.yml. PR title, body, files and
 * comments are data; nothing from the PR branch is imported or executed.
 *
 * - Owner is Michael's numeric account only. Bots and delegated accounts are
 *   never owner (Skeptic H1).
 * - Security sensitivity comes from the GitHub-reported changed-file list,
 *   not PR text, so a PR cannot talk its way out of a hold (H2).
 * - A security-sensitive change needs a signed owner exception even with 7/7
 *   and green CI. Green CI never lifts a security hold (H1).
 * - The owner verification key is pinned in config on main, not in repo
 *   variables (H3).
 * - The result is published as a check run by a dedicated GitHub App, not a
 *   generic Actions commit status (C2). Without that App configured the gate
 *   publishes nothing and stays closed.
 */
import {evaluateCouncilAcceptance,validateOwnerOverride} from './council-release-gate.mjs';

export const GATE_CHECK_NAME='ultron/council-7of7';
export const OWNER=Object.freeze({login:'michaeljwilliams0123',id:308995719});
const REPO='michaeljwilliams0123/Ultron.MW';
const REPO_ID=1424939667;
const SHA=/^[a-f0-9]{40}$/;
const MAX_FILES=3000; // GitHub's PR files API hard limit.

// Paths whose change can alter governance, CI, credentials or supply chain.
const SECURITY_PATHS=Object.freeze([
 /^\.github\//,
 /^src\/council-(?:release-gate|trusted-gate|members|publication|reasoning|governance-repair-admission)\.mjs$/,
 /^scripts\/(?:enforce-council-acceptance|council-debate|council-act)\.mjs$/,
 /^config\//,
 /^src\/security\//,
 /(?:^|\/)[^/]*(?:auth|credential|secret|token|signing|signature|capabilit|permission|ruleset|admin|oidc|passkey)[^/]*$/i,
 /^package(?:-lock)?\.json$/,
 /^scripts\/(?:verify|lint-workflows|verify-audited-lockfile)\b/,
 /^SECURITY\.md$/
]);
const INFRA_PATHS=Object.freeze([/^\.github\//,/^cloud\//,/^scripts\//,/^hubs\//]);

const canonical=repo=>repo?.id===REPO_ID&&repo?.full_name===REPO;

export function isOwnerAccount(user){
 return user?.login===OWNER.login&&user?.id===OWNER.id&&
  (user?.type===undefined||user.type==='User');
}

/** Owner intent: owner-authored PR, or an owner APPROVED review on the exact head. */
export function ownerIntent(pr,reviews=[]){
 if(!pr||!SHA.test(pr.head?.sha||''))return {owner:false,via:null};
 if(isOwnerAccount(pr.user))return {owner:true,via:'owner-authored'};
 const approved=Array.isArray(reviews)&&reviews.some(r=>
  isOwnerAccount(r?.user)&&r?.state==='APPROVED'&&r?.commit_id===pr.head.sha);
 return approved?{owner:true,via:'owner-approved-exact-head'}:{owner:false,via:null};
}

/** Classify risk from the trusted GitHub changed-file list only. */
export function classifyTrustedRisk({files,filesComplete}={}){
 if(filesComplete!==true||!Array.isArray(files)||files.length<1||files.length>=MAX_FILES)
  return Object.freeze({security:true,infra:true,complete:false,
   securityPaths:Object.freeze([]),reason:'changed-file-list-incomplete'});
 const names=new Set();
 for(const f of files){
  for(const name of [f?.filename,f?.previous_filename]){
   if(typeof name==='string'&&name)names.add(name);
  }
 }
 if(names.size<1)return Object.freeze({security:true,infra:true,complete:false,
  securityPaths:Object.freeze([]),reason:'changed-file-list-invalid'});
 const securityPaths=[...names].filter(n=>SECURITY_PATHS.some(r=>r.test(n))).sort();
 const infra=[...names].some(n=>INFRA_PATHS.some(r=>r.test(n)));
 return Object.freeze({security:securityPaths.length>0,infra,complete:true,
  securityPaths:Object.freeze(securityPaths),reason:null});
}

function held(reason,extra={}){
 return Object.freeze({schema:'ultron.council-trusted-gate.v2',status:'held',
  reason,approvedCount:extra.approvedCount??0,requiredCount:7,
  holdRoles:Object.freeze([...(extra.holdRoles||[])]),
  modelHoldRoles:Object.freeze([...(extra.modelHoldRoles||[])]),
  overrideUsed:false,...extra});
}

export function evaluateTrustedCouncilGate({report,receipt,pr,files,filesComplete,
 overrideComment=null,ownerPublicJwk=null,now=new Date().toISOString()}={}){
 if(!pr||pr.state!=='open'||!Number.isSafeInteger(pr.number)||pr.number<1||
   !SHA.test(pr.head?.sha||'')||!SHA.test(pr.base?.sha||'')||
   pr.base?.ref!=='main'||!canonical(pr.head?.repo)||!canonical(pr.base?.repo))
  return held('pr-provenance-unverified');
 const sourceSha=pr.head.sha,baseSha=pr.base.sha,prNumber=pr.number;
 const risk=classifyTrustedRisk({files,filesComplete});
 const common={sourceSha,baseSha,prNumber,
  securitySensitive:risk.security,securityPaths:risk.securityPaths};
 const base=evaluateCouncilAcceptance({report,receipt,sourceSha,baseSha,prNumber,
  overrideComment,ownerPublicJwk,now});
 if(base.status==='accepted'&&risk.security){
  const override=validateOwnerOverride(overrideComment,{sourceSha,baseSha,prNumber,
   ownerPublicJwk,now});
  if(!override)return held(risk.complete?
    'security-sensitive-change-requires-signed-owner-exception':risk.reason,
   {...common,approvedCount:base.approvedCount});
  return Object.freeze({...base,...common,schema:'ultron.council-trusted-gate.v2',
   status:'owner-overridden',reason:'signed-owner-exception-for-security-change',
   overrideUsed:true,overrideCommentId:override.commentId,
   overrideReason:override.reason,overrideSignatureVerified:true});
 }
 return Object.freeze({...base,...common,schema:'ultron.council-trusted-gate.v2'});
}

export function gatePasses(result,sha,prNumber){
 return !!result&&SHA.test(sha||'')&&result.sourceSha===sha&&
  result.prNumber===prNumber&&
  ((result.status==='accepted'&&result.approvedCount===7&&
    result.securitySensitive===false)||
   (result.status==='owner-overridden'&&result.overrideUsed===true&&
    result.overrideSignatureVerified===true));
}

/** Check-run body for the dedicated gate App. Anything not proven passes as failure. */
export function buildGateCheckRun(result,{sha,prNumber,detailsUrl}={}){
 if(!SHA.test(sha||''))throw Error('Council gate check target invalid');
 const pass=gatePasses(result,sha,prNumber);
 const title=pass?(result.status==='accepted'?
   '7/7 Council roles and model reviews on exact head':
   'Signed owner exception #'+result.overrideCommentId):
  'Council HOLD: '+String(result?.reason||'no-trusted-result');
 const lines=[
  '**Decision:** '+String(result?.status||'held'),
  '**PR:** #'+String(prNumber),
  '**Head:** '+sha,
  '**Role approvals:** '+String(result?.approvedCount??0)+'/7',
  '**Held roles:** '+((result?.holdRoles||[]).join(', ')||'none'),
  '**Model hold/unavailable:** '+((result?.modelHoldRoles||[]).join(', ')||'none'),
  '**Security-sensitive paths:** '+((result?.securityPaths||[]).join(', ')||'none'),
  'Evaluated by main-branch code only. Green CI never lifts a security hold.'
 ];
 return Object.freeze({name:GATE_CHECK_NAME,head_sha:sha,status:'completed',
  conclusion:pass?'success':'failure',
  ...(detailsUrl?{details_url:detailsUrl}:{}),
  output:{title:title.slice(0,240),summary:lines.join('\n').slice(0,60000)}});
}

/**
 * The gate may publish only through its dedicated App. Returns null (publish
 * nothing, stay closed) unless the App id and slug are configured and the
 * slug of the token actually minted matches the configured slug.
 */
export function resolveGatePublisher({appId,expectedSlug,mintedSlug}={}){
 if(!/^[1-9][0-9]{0,11}$/.test(String(appId||''))||
   !/^[a-z0-9][a-z0-9-]{1,38}$/.test(String(expectedSlug||''))||
   mintedSlug!==expectedSlug)
  return null;
 return Object.freeze({appId:Number(appId),slug:expectedSlug});
}
