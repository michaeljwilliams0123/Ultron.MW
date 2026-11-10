import {createHash} from 'node:crypto';

/**
 * Bounded test -> repair -> verify -> publication coordinator.
 *
 * No shell, filesystem writes, GitHub credentials, mutation endpoint, or
 * provider calls originate here. The composition root injects an independently
 * authorized GitHub patch adapter, an isolated exact-head test runner and a
 * crash-durable compare-and-set ledger. External writes are reserved BEFORE
 * dispatch and are NEVER replayed after an uncertain response.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const OWNER='michaeljwilliams0123';
const SHA=/^[a-f0-9]{40}$/;
const KEY=/^[a-z][a-z0-9-]{7,79}$/;
const BRANCH=/^ultron\/repair-[a-z0-9][a-z0-9-]{2,63}$/;
const PATH=/^(?:src|test)\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:mjs|js|ts|json)$/;
const PHASES=new Set(['ready','patch-dispatched','applied','verifying','verified',
 'publication-dispatched','complete','exhausted']);
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const output=(status,row,reason)=>Object.freeze({
 status,attempt:row?.attempt??0,headSha:row?.headSha??null,
 prNumber:row?.prNumber??null,...(reason?{reason}:{})
});
const ownKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const safeTrace=value=>String(value??'').slice(0,10000)
 .replace(/(\bAuthorization\s*:\s*Bearer\s+)[^\s;]+/gi,'$1[redacted]')
 .replace(/\b(?:gh[pousr]_[a-z0-9_]{16,}|github_pat_[a-z0-9_]{16,}|sk-[a-z0-9_-]{20,})\b/gi,'[redacted]')
 .replace(/\b(?:AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|GOOGLE_API_KEY|OPENAI_API_KEY)\s*[:=]\s*[^\s;]+/gi,'[redacted]')
 .replace(/\b(?:password|passcode|secret|token|api[_ -]?key)\s*[:=]\s*[^\s;]+/gi,'[redacted]')
 .replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1500);

/** Immutable task identity. Caller-supplied instructions do NOT authorize a write. */
export function createAutonomousRepairPlan(raw,at=Date.now()){
 const expires=Date.parse(raw?.expiresAt??'');
 if(!ownKeys(raw,['id','owner','repository','branch','baseSha','objective',
  'allowedPaths','maxAttempts','maxPaidCents','paidFallback','expiresAt'])||
  !KEY.test(raw.id||'')||raw.owner!==OWNER||raw.repository!==REPO||
  !BRANCH.test(raw.branch||'')||!SHA.test(raw.baseSha||'')||
  typeof raw.objective!=='string'||raw.objective.length<12||
  raw.objective.length>240||/[\u0000-\u001f\u007f]/.test(raw.objective)||
  !Array.isArray(raw.allowedPaths)||raw.allowedPaths.length<1||
  raw.allowedPaths.length>6||new Set(raw.allowedPaths).size!==raw.allowedPaths.length||
  raw.allowedPaths.some(path=>typeof path!=='string'||!PATH.test(path)||
   path.includes('..')||path.includes('//'))||
  !Number.isInteger(raw.maxAttempts)||raw.maxAttempts<1||raw.maxAttempts>3||
  raw.maxPaidCents!==0||raw.paidFallback!==false||
  !Number.isFinite(at)||!Number.isFinite(expires)||
  expires<=at||expires>at+86400000)
  throw Error('autonomous-repair-plan-invalid');
 const payload={schema:'ultron.autonomous-repair.v1',id:raw.id,owner:OWNER,
  repository:REPO,branch:raw.branch,baseSha:raw.baseSha,
  objective:raw.objective,allowedPaths:Object.freeze([...raw.allowedPaths]),
  maxAttempts:raw.maxAttempts,maxPaidCents:0,paidFallback:false,
  expiresAt:new Date(expires).toISOString()};
 return Object.freeze({...payload,fingerprint:fingerprint(payload)});
}
function validateManifest(plan,manifest,headSha){
 if(!ownKeys(manifest,['objective','baseSha','changes'])||
  typeof manifest.objective!=='string'||!manifest.objective.trim()||
  manifest.objective.length>300||manifest.baseSha!==headSha||
  !Array.isArray(manifest.changes)||manifest.changes.length<1||
  manifest.changes.length>plan.allowedPaths.length)return false;
 const seen=new Set();
 for(const change of manifest.changes){
  if(!ownKeys(change,['path','before','after'])||
   !plan.allowedPaths.includes(change.path)||seen.has(change.path)||
   typeof change.before!=='string'||!change.before||change.before.length>16000||
   typeof change.after!=='string'||!change.after||change.after.length>16000||
   change.after===change.before)return false;
  seen.add(change.path);
 }
 return JSON.stringify(manifest).length<=22000;
}
function assertRecord(plan,row){
 if(!row||row.id!==plan.id||row.fingerprint!==plan.fingerprint||
  !PHASES.has(row.phase)||!Number.isInteger(row.attempt)||
  row.attempt<0||row.attempt>plan.maxAttempts||
  !SHA.test(row.headSha||'')||!Number.isInteger(row.version)||row.version<0)
  throw Error('autonomous-repair-checkpoint-conflict');
 return row;
}
async function stepLedger(plan,ledger,row,to,changes={}){
 const updated=await ledger.transition({id:plan.id,fingerprint:plan.fingerprint,
  from:row.phase,to,changes,expectedVersion:row.version});
 if(!updated)throw Error('autonomous-repair-CAS-contention');
 const persisted=assertRecord(plan,await ledger.read(plan.id));
 if(persisted.phase!==to||persisted.version!==row.version+1||
    JSON.stringify(persisted)!==JSON.stringify(updated))
  throw Error('autonomous-repair-checkpoint-readback-mismatch');
 return persisted;
}
async function isAuthorized(authorize,plan,operation,row){
 if(typeof authorize!=='function')return false;
 try{return await authorize({plan,operation,attempt:row.attempt,
  headSha:row.headSha})===true;}catch{return false;}
}
function patchSeen(row,observation){
 return observation?.verified===true&&
  observation.baseSha===row.headSha&&
  SHA.test(observation.headSha||'')&&observation.headSha!==row.headSha&&
  observation.patchDigest===row.patchDigest;
}
function verifiedRun(row,run){
 return run?.state==='completed'&&run.verified===true&&
  run.headSha===row.headSha&&Number.isSafeInteger(run.runId)&&run.runId>0&&
  ['success','failure','cancelled','timed_out'].includes(run.conclusion);
}
async function checkPatch(plan,ledger,row,patcher){
 let found;
 try{found=await patcher.observe({plan,manifest:row.manifest,
  attempt:row.attempt,expectedHeadSha:row.headSha});}catch{return null;}
 if(!patchSeen(row,found))return null;
 return stepLedger(plan,ledger,row,'applied',{headSha:found.headSha});
}
async function completeTest(plan,ledger,row,verifier){
 let observation;
 try{observation=await verifier.observe({plan,attempt:row.attempt,
  headSha:row.headSha});}catch{return {status:'reconcile-required',row};}
 if(observation?.state==='pending')return {status:'verifying',row};
 if(!verifiedRun(row,observation))return {status:'reconcile-required',row};
 if(observation.conclusion==='success'){
  const verified=await stepLedger(plan,ledger,row,'verified',{errorTrace:''});
  return {status:'verified',row:verified};
 }
 const errorTrace=safeTrace(observation.errorTrace||'FAIL: '+observation.conclusion);
 const exhausted=row.attempt>=plan.maxAttempts;
 const after=await stepLedger(plan,ledger,row,exhausted?'exhausted':'ready',
  {errorTrace});
 return {status:exhausted?'exhausted':'retry',row:after};
}
function checkPR(plan,row,observed){
 return observed?.verified===true&&observed.branch===plan.branch&&
  observed.headSha===row.headSha&&
  Number.isSafeInteger(observed.prNumber)&&observed.prNumber>0;
}
async function checkPublication(plan,ledger,row,publisher){
 let found;
 try{found=await publisher.observe({plan,headSha:row.headSha});}
 catch{return null;}
 if(!checkPR(plan,row,found))return null;
 return stepLedger(plan,ledger,row,'complete',{prNumber:found.prNumber});
}

/** One bounded execution cycle, resumable from any durable checkpoint. */
export async function runAutonomousRepair({plan,ledger,repairer,patcher,
 verifier,publisher,authorize,now=Date.now,maxSteps=24}={}){
 if(plan?.schema!=='ultron.autonomous-repair.v1'||
  !Number.isInteger(maxSteps)||maxSteps<1||maxSteps>32||
  typeof ledger?.claim!=='function'||typeof ledger?.read!=='function'||
  typeof ledger?.transition!=='function'||typeof repairer?.propose!=='function'||
  typeof patcher?.apply!=='function'||typeof patcher?.observe!=='function'||
  typeof verifier?.start!=='function'||typeof verifier?.observe!=='function'||
  typeof now!=='function')
  throw Error('autonomous-repair-adapter-invalid');
 // Revalidate original immutable plan, not merely its schema marker.
 const {schema,fingerprint:hash,...source}=plan;
 const nowMs=now(),expires=Date.parse(source.expiresAt);
 // Expiry blocks NEW mutations, not read-only recovery of dispatched writes.
 // Validate the original immutable plan against its last eligible instant.
 const checked=createAutonomousRepairPlan(source,Math.min(nowMs,expires-1));
 if(hash!==checked.fingerprint)throw Error('autonomous-repair-plan-fingerprint-invalid');
 // Never create a new durable attempt using an already-expired grant.
 const existing=nowMs>=expires?await ledger.read(plan.id):await ledger.claim(plan);
 if(!existing)return output('held',null,'plan-expired-no-checkpoint');
 let row=assertRecord(plan,existing);
 for(let step=0;step<maxSteps;step++){
  row=assertRecord(plan,await ledger.read(plan.id));
  if(row.phase==='complete'){
   // A historical completion is not an independent external PR readback.
   let current;
   try{current=await publisher?.observe?.({plan,headSha:row.headSha});}
   catch{return output('reconcile-required',row,'published-pr-readback-unavailable');}
   if(!checkPR(plan,row,current))
    return output('reconcile-required',row,'published-pr-readback-missing');
   return output('completed',row);
  }
  if(row.phase==='exhausted')return output('exhausted',row);
  if(row.phase==='patch-dispatched'){
   const applied=await checkPatch(plan,ledger,row,patcher);
   if(!applied)return output('reconcile-required',row,'patch-dispatch-outcome-unknown');
   row=applied;
  }
  if(row.phase==='ready'){
   if(row.attempt>=plan.maxAttempts)return output('exhausted',row);
   if(now()>=Date.parse(plan.expiresAt)||
      !await isAuthorized(authorize,plan,'repair.branch.update',row))
    return output('held',row,'authorization-unavailable');
   let manifest;
   try{manifest=await repairer.propose({plan,attempt:row.attempt+1,
    headSha:row.headSha,previousFailure:row.errorTrace});}
   catch{return output('held',row,'repair-proposal-unavailable');}
   if(!validateManifest(plan,manifest,row.headSha))
    return output('held',row,'repair-proposal-out-of-scope');
   const proposed=await stepLedger(plan,ledger,row,'patch-dispatched',{
    attempt:row.attempt+1,manifest,patchDigest:fingerprint(manifest)});
   // Recheck stop/owner grant immediately before a one-time provider write.
   if(now()>=Date.parse(plan.expiresAt)||
      !await isAuthorized(authorize,plan,'repair.branch.update',proposed))
    return output('reconcile-required',proposed,'reserved-write-held');
   try{await patcher.apply({plan,manifest,attempt:proposed.attempt,
    expectedHeadSha:proposed.headSha});}
   catch{/* Outcome unknown: query only; never repeat the patch. */}
   const applied=await checkPatch(plan,ledger,proposed,patcher);
   if(!applied)return output('reconcile-required',proposed,'patch-readback-unavailable');
   row=applied;
  }
  if(row.phase==='applied'){
   const claimed=await stepLedger(plan,ledger,row,'verifying');
   try{await verifier.start({plan,attempt:claimed.attempt,headSha:claimed.headSha});}
   catch{/* The CI dispatch may have succeeded; observe before proceeding. */}
   row=claimed;
  }
  if(row.phase==='verifying'){
   const checked=await completeTest(plan,ledger,row,verifier);
   if(checked.status==='verifying')return output('verifying',checked.row);
   if(checked.status==='reconcile-required')
    return output('reconcile-required',row,'test-readback-unavailable');
   row=checked.row;
   if(checked.status==='exhausted')return output('exhausted',row);
   if(checked.status==='retry')continue;
  }
  if(row.phase==='verified'){
   if(typeof publisher?.start!=='function'||typeof publisher?.observe!=='function')
    return output('verified-awaiting-publication',row);
   if(now()>=Date.parse(plan.expiresAt)||
      !await isAuthorized(authorize,plan,'repair.pr.create',row))
    return output('held',row,'publication-not-authorized');
   const claimed=await stepLedger(plan,ledger,row,'publication-dispatched');
   try{await publisher.start({plan,headSha:claimed.headSha});}
   catch{/* Unknown POST result is only reconciled by readback. */}
   row=claimed;
  }
  if(row.phase==='publication-dispatched'){
   if(typeof publisher?.observe!=='function')
    return output('reconcile-required',row,'publication-adapter-missing');
   const completed=await checkPublication(plan,ledger,row,publisher);
   if(!completed)return output('reconcile-required',row,'publication-readback-unavailable');
   return output('completed',completed);
  }
 }
 return output('partial',row,'bounded-execution-step-budget');
}
