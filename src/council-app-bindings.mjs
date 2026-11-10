/** Trusted separation between a Council role and the GitHub App that executes it.
 * A role controls admission. An App binding proves provenance only; even the
 * elevated Coordinator cannot widen the Builder role's allowlisted actions.
 */
export const COUNCIL_APP_ROLES=Object.freeze([
 'Builder','Skeptic','Steward','Predictor','Generator','Sentinel','Companion'
]);
const ROLE_SET=new Set(COUNCIL_APP_ROLES);
export const COUNCIL_COORDINATOR_APP_ID=5633654;

const member=role=>Object.freeze({
 bindingKey:'council-member',kind:'council-member',role,
 appId:null,appSlug:'ultron-mw-'+role.toLowerCase(),
 appSlugs:Object.freeze(['ultron-mw-'+role.toLowerCase()]),
 independentReview:false
});
// One verified GitHub App is shared across seven logical, attributed Council
// roles. Role attribution is NOT an independent identity or approval.
const coordinatorFor=role=>Object.freeze({
 bindingKey:'coordinator-v2',kind:'coordinator',role,
 appId:COUNCIL_COORDINATOR_APP_ID,appSlug:'ultron-coordinator',
 // Builder's historical slug is allowed only for its pre-rename receipts.
 appSlugs:Object.freeze(role==='Builder'
  ?['ultron-coordinator','ultron-mw-builder-v2']:['ultron-coordinator']),
 independentReview:false
});
const BINDINGS=Object.freeze(Object.fromEntries(COUNCIL_APP_ROLES.map(role=>[
 role,Object.freeze([member(role),coordinatorFor(role)])
])));
const REGISTERED_BINDINGS=Object.freeze(Object.values(BINDINGS).flat()
 .filter(binding=>binding.appId!==null));

function roleCheck(role){
 if(!ROLE_SET.has(role))throw Error('council-role-invalid');
}
function appIdCheck(appId){
 if(!Number.isSafeInteger(appId)||appId<1)throw Error('council-identity-mismatch');
}
function slugCheck(appSlug){
 if(typeof appSlug!=='string'||!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(appSlug))
  throw Error('council-identity-mismatch');
}

export function councilAppBindingBlueprints(role){
 roleCheck(role);
 return BINDINGS[role];
}

/** Resolve only an allowlisted role/App pair. Unregistered member blueprints
 * additionally require an App ID from the owner's protected credential set.
 */
export function resolveCouncilAppIdentity({role,appId,appSlug,expectedAppId}={}){
 roleCheck(role);appIdCheck(appId);slugCheck(appSlug);
 if(expectedAppId!==undefined){
  appIdCheck(expectedAppId);
  if(appId!==expectedAppId)throw Error('council-identity-mismatch');
 }
 const registered=REGISTERED_BINDINGS.some(candidate=>candidate.appId===appId);
 if(registered&&!REGISTERED_BINDINGS.some(candidate=>candidate.appId===appId&&
  candidate.role===role&&candidate.appSlugs.includes(appSlug)))
  throw Error('council-identity-mismatch');
 const binding=BINDINGS[role].find(candidate=>
  candidate.appSlugs.includes(appSlug)&&
  (candidate.appId===appId||(candidate.appId===null&&expectedAppId===appId)));
 if(!binding)throw Error('council-identity-mismatch');
 return Object.freeze({
  role,appId,appSlug,botLogin:appSlug+'[bot]',
  bindingKey:binding.bindingKey,kind:binding.kind,
  independentReview:binding.independentReview
 });
}

/** Receipt verification may trust the known Coordinator ID directly. For a
 * separately provisioned member App, the receipt's App ID is already bound by
 * the protected credential and live installation probe that branded its actor.
 */
export function resolveReceiptAppIdentity(input={}){
 const bindings=BINDINGS[input.role]||[];
 const registeredId=REGISTERED_BINDINGS.some(binding=>binding.appId===input.appId);
 const known=bindings.some(binding=>
  binding.appId===input.appId&&binding.appSlugs.includes(input.appSlug));
 if(registeredId&&!known)throw Error('council-identity-mismatch');
 return resolveCouncilAppIdentity({...input,
  expectedAppId:known?undefined:input.appId});
}
