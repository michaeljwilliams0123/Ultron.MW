/** Durable production evidence for operations that must fail closed before a provider write. */
const OWNER='michaeljwilliams0123';
const KEY=/^gov:[a-z0-9_.:-]{8,116}$/;
const SHA=/^[a-f0-9]{40}$/;
const FINGERPRINT=/^[a-f0-9]{64}$/;
const SCENARIOS=new Set([
 'positive-cost','stale-fence','forbidden-operation','ineligible-release'
]);
const FORBIDDEN=new Set([
 'repo.ruleset.update','repo.branch-protection.update','repo.secret.write',
 'repo.merge','repo.visibility.update','billing.change'
]);

function own(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 let descriptors;try{descriptors=Object.getOwnPropertyDescriptors(raw);}catch{return null;}
 const expected=['expectedProfileVersion','expectedStopVersion','fencingGeneration','key',
  'operation','prHeadSha','prNumber','requestedCostCents','scenario','sourceSha','taskId'];
 if(Object.keys(descriptors).sort().join(',')!==expected.sort().join(','))return null;
 const value=Object.create(null);
 for(const [key,descriptor] of Object.entries(descriptors)){
  if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))return null;
  value[key]=descriptor.value;
 }
 return value;
}
function integerOrNull(value,min=1){
 return value===null||Number.isSafeInteger(value)&&value>=min;
}
function normalize(raw){
 const value=own(raw);
 if(!value||typeof value.key!=='string'||!KEY.test(value.key)||
   !SCENARIOS.has(value.scenario)||typeof value.operation!=='string'||
   value.operation.length<3||value.operation.length>80||!SHA.test(value.sourceSha)||
   !Number.isSafeInteger(value.requestedCostCents)||value.requestedCostCents<0||
   !Number.isSafeInteger(value.expectedProfileVersion)||value.expectedProfileVersion<1||
   !Number.isSafeInteger(value.expectedStopVersion)||value.expectedStopVersion<1||
   !integerOrNull(value.taskId)||!integerOrNull(value.fencingGeneration)||
   !integerOrNull(value.prNumber)||!(value.prHeadSha===null||SHA.test(value.prHeadSha)))return null;
 if(value.scenario==='positive-cost'&&(value.requestedCostCents<1||value.taskId!==null||
    value.fencingGeneration!==null||value.prNumber!==null||value.prHeadSha!==null))return null;
 if(value.scenario==='stale-fence'&&(!value.taskId||!value.fencingGeneration||
    value.requestedCostCents!==0||value.prNumber!==null||value.prHeadSha!==null))return null;
 if(value.scenario==='forbidden-operation'&&(!FORBIDDEN.has(value.operation)||
    value.requestedCostCents!==0||value.taskId!==null||value.fencingGeneration!==null||
    value.prNumber!==null||value.prHeadSha!==null))return null;
 if(value.scenario==='ineligible-release'&&(value.operation!=='repo.pr.squash'||
    value.requestedCostCents!==0||value.taskId!==null||value.fencingGeneration!==null||
    !value.prNumber||!value.prHeadSha))return null;
 return Object.freeze(value);
}
async function digest(value){
 const bytes=new TextEncoder().encode(JSON.stringify(['ultron.governance-acceptance.v1',value]));
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const READ=`SELECT receipt_key AS "key",fingerprint,scenario,source_sha AS "sourceSha",
 operation,requested_cost_cents AS "requestedCostCents",disposition,reason,
 provider_writes AS "providerWrites",observed,created_at AS "createdAt"
 FROM governance_acceptance_receipts WHERE receipt_key=$1`;
const AUTH=`SELECT a.owner,a.version AS "profileVersion",a.max_paid_cents AS "maxPaidCents",
 c.paused,c.version AS "stopVersion" FROM brain_owner_autonomy_profile a
 JOIN brain_runtime_control c ON c.id=1 WHERE a.id=1`;
const TASK=`SELECT id,status,fencing_generation AS "fencingGeneration",attempts
 FROM brain_tasks WHERE id=$1`;
const INSERT=`INSERT INTO governance_acceptance_receipts
 (receipt_key,fingerprint,scenario,source_sha,operation,requested_cost_cents,
  expected_profile_version,expected_stop_version,task_id,provided_fencing_generation,
  pr_number,pr_head_sha,disposition,reason,provider_writes,observed)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'held',$13,0,$14::jsonb)
 ON CONFLICT(receipt_key) DO NOTHING RETURNING receipt_key`;

const held=(reason,extra={})=>Object.freeze({status:'held',reason,
 productionAccepted:false,providerWrites:0,...extra});
const invalid=reason=>Object.freeze({status:'invalid',reason,
 productionAccepted:false,providerWrites:0});
const uncertain=reason=>Object.freeze({status:'reconcile-required',reason,
 productionAccepted:false,providerWrites:0});

/**
 * Evaluate and persist a real production denial. Observers are read-only by contract;
 * this module has no provider mutation callback and cannot turn a denial into execution.
 */
export async function recordGovernanceAcceptance({db,request,observeMain,observePullRequest}={}){
 const input=normalize(request);
 if(!input||typeof db?.query!=='function'||typeof observeMain!=='function')
  return invalid('invalid-governance-request');
 const fingerprint=await digest(input);
 if(!FINGERPRINT.test(fingerprint))return invalid('invalid-governance-request');
 const read=async()=>{
  const result=await db.query(READ,[input.key]);
  if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error('receipt-read-ambiguous');
  return result.rows[0]||null;
 };
 let prior;
 try{prior=await read();}catch{return uncertain('receipt-read-unavailable');}
 if(prior)return prior.fingerprint===fingerprint?
  held(prior.reason,{reused:true,receipt:prior}):invalid('idempotency-conflict');

 let authority,main;
 try{
  const result=await db.query(AUTH);
  authority=result?.rows?.length===1?result.rows[0]:null;
  main=await observeMain();
 }catch{return uncertain('governance-evidence-unavailable');}
 if(authority?.owner!==OWNER||!Number.isSafeInteger(authority.profileVersion)||
   !Number.isSafeInteger(authority.stopVersion)||typeof authority.paused!=='boolean'||
   authority.maxPaidCents!==0||!SHA.test(main?.sha||''))
  return uncertain('governance-evidence-unavailable');

 const observed={mainSha:main.sha,owner:authority.owner,
  profileVersion:authority.profileVersion,stopVersion:authority.stopVersion,
  paused:authority.paused,maxPaidCents:authority.maxPaidCents};
 let reason;
 if(main.sha!==input.sourceSha)reason='source-drift';
 else if(authority.profileVersion!==input.expectedProfileVersion||
   authority.stopVersion!==input.expectedStopVersion)reason='authority-version-stale';
 else if(authority.paused)reason='owner-paused';
 else if(input.scenario==='positive-cost')reason='positive-cost-denied';
 else if(input.scenario==='forbidden-operation')reason='forbidden-operation-denied';
 else if(input.scenario==='stale-fence'){
  let task;
  try{const result=await db.query(TASK,[input.taskId]);task=result?.rows?.length===1?result.rows[0]:null;}
  catch{return uncertain('task-fence-read-unavailable');}
  if(!task||!Number.isSafeInteger(task.fencingGeneration))
   return uncertain('task-fence-read-unavailable');
  observed.task={id:task.id,status:task.status,attempts:task.attempts,
   fencingGeneration:task.fencingGeneration};
  if(task.fencingGeneration===input.fencingGeneration)
   return invalid('fencing-generation-not-stale');
  reason='stale-fencing-generation';
 }else{
  if(typeof observePullRequest!=='function')return uncertain('pull-request-evidence-unavailable');
  let pr;
  try{pr=await observePullRequest({number:input.prNumber,headSha:input.prHeadSha});}
  catch{return uncertain('pull-request-evidence-unavailable');}
  if(!pr||pr.number!==input.prNumber||pr.headSha!==input.prHeadSha)
   return uncertain('pull-request-evidence-unavailable');
  observed.pullRequest=pr;
  reason=pr.exactHeadChecksGreen&&pr.eligibleIndependentApproval===false?
   'independent-review-required':pr.exactHeadChecksGreen?
   'release-mutation-not-authorized':'exact-head-ci-unverified';
 }

 let created=false;
 try{
  const inserted=await db.query(INSERT,[input.key,fingerprint,input.scenario,input.sourceSha,
   input.operation,input.requestedCostCents,input.expectedProfileVersion,
   input.expectedStopVersion,input.taskId,input.fencingGeneration,input.prNumber,
   input.prHeadSha,reason,JSON.stringify(observed)]);
  created=Array.isArray(inserted?.rows)&&inserted.rows.length===1;
 }catch{/* Read back; never retry the write. */}
 let stored;
 try{stored=await read();}catch{return uncertain('receipt-read-unavailable');}
 if(!stored)return uncertain('receipt-write-outcome-unknown');
 if(stored.fingerprint!==fingerprint)return invalid('idempotency-conflict');
 return held(stored.reason,{reused:!created,receipt:stored});
}

export const GOVERNANCE_ACCEPTANCE_SCENARIOS=Object.freeze([...SCENARIOS]);
export const GOVERNANCE_FORBIDDEN_OPERATIONS=Object.freeze([...FORBIDDEN]);
