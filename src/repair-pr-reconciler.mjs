import { createHash } from 'node:crypto';
import { admitRepairTask, assertRepairStep } from './repair-admission.mjs';

/**
 * Source-only Repair App branch/PR reconciliation contract.
 * Does not authenticate a GitHub App or perform arbitrary GitHub requests.
 * Production must inject a separately authenticated, repository-scoped GitHub
 * adapter and a durable compare-and-swap PostgreSQL ledger.
 */
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PHASES = new Set(['reserved','branch-dispatch','branch-confirmed','pr-dispatch','complete']);

export function createMemoryRepairLedger() {
  // Test fixture only; NOT crash durable and cannot prove live acceptance.
  const state = new Map();
  return Object.freeze({
    async claim({key,fingerprint}){
      if(!state.has(key)){
        const entry={key,fingerprint,phase:'reserved',prNumber:null};
        state.set(key,entry);
        return {claimed:true,entry:{...entry}};
      }
      return {claimed:false,entry:{...state.get(key)}};
    },
    async get(key){
      const entry=state.get(key);
      return entry&&{...entry};
    },
    async advance({key,fingerprint,from,to,prNumber=null}){
      const entry=state.get(key);
      if(!entry||entry.fingerprint!==fingerprint||
          entry.phase!==from || !PHASES.has(to))
        return false;
      state.set(key,{...entry,phase:to,
        prNumber:prNumber??entry.prNumber});
      return true;
    }
  });
}
function assertAdapter({ledger,github,readContext}){
  if(!ledger||!['claim','get','advance'].every(k=>typeof ledger[k]==='function')||
     !github||!['getBranch','createBranch','findPR','createPR'].every(k=>typeof github[k]==='function')||
     typeof readContext!=='function')
    throw Error('Repair execution adapter or ledger missing');
}
function branchVerified(value,admission){
  return value && value.repo===admission.repository &&
    value.ref===admission.branch && value.sha===admission.baseSha;
}
function prVerified(value,admission,marker){
  return value && Number.isSafeInteger(value.number) && value.number>0 &&
    value.repo===admission.repository &&
    value.head===admission.branch && value.base==='main' &&
    value.draft===false && typeof value.body==='string' &&
    value.body.includes(marker) && typeof value.title==='string' &&
    value.title===titleFor(admission);
}
function titleFor(admission){
  return 'repair: '+admission.objective.slice(0,90);
}
function result(entry,admission,marker,status){
  return Object.freeze({
    schema:'ultron.repair.pr-reconciliation.v1',
    status,phase:entry.phase,objective:admission.objective,
    repository:admission.repository,baseSha:admission.baseSha,
    branch:admission.branch,idempotencyKey:admission.idempotencyKey,
    fingerprint:entry.fingerprint,prNumber:entry.prNumber||null,prMarker:marker,
    independentlyObserved:false,liveGitHubVerified:false,
    mergeAuthorized:false,deployAuthorized:false
  });
}
/**
 * Single caller advances one admitted repair through branch create and PR
 * creation. Every externally visible dispatch is preceded by an atomic CAS
 * state transition; after an unknown outcome it only reads GitHub, and never
 * repeats a mutation with the same idempotency key.
 *
 * Resumption may reconcile a previously dispatched write, but cannot assume
 * a missing object means that a lost response represents a failed write.
 */
export async function runRepairPR({plan,ledger,github,readContext}={}){
  assertAdapter({ledger,github,readContext});
  const ctx=await readContext();
  const admission=admitRepairTask({plan,...ctx});
  const key=admission.idempotencyKey;
  const fingerprint=sha256({
    owner:admission.owner,objective:admission.objective,
    repository:admission.repository,baseSha:admission.baseSha,
    branch:admission.branch,allowedPaths:admission.allowedPaths,
    maxAttempts:admission.maxAttempts,maxCostCents:admission.maxCostCents,
    expiresAt:admission.expiresAt,
  });
  const marker='<!-- ultron-repair:'+fingerprint+' -->';
  const claim=await ledger.claim({key,fingerprint});
  if(!claim?.entry||claim.entry.fingerprint!==fingerprint)
    throw Error('Repair idempotency fingerprint collision');
  let entry=claim.entry;
  if(!PHASES.has(entry.phase))
    throw Error('Repair persisted phase unavailable');

  const reRead=async()=>{
    const read=await ledger.get(key);
    if(!read||read.fingerprint!==fingerprint||!PHASES.has(read.phase))
      throw Error('Repair idempotency fingerprint collision');
    return read;
  };
  async function stepGate(operation){
    const next=await readContext();
    assertRepairStep(admission,{
      operation,repository:admission.repository,branch:admission.branch,
      baseSha:admission.baseSha,idempotencyKey:key,attempt:1,
    },next);
  }
  if(['branch-confirmed','pr-dispatch','complete'].includes(entry.phase)){
    // Completion and resumption are observations, not permanent authority:
    // out-of-band deletion or a changed branch ref invalidates stale receipts.
    const branch=await github.getBranch({
      repository:admission.repository,branch:admission.branch
    });
    if(!branch)return result(entry,admission,marker,'reconcile-required');
    if(!branchVerified(branch,admission))
      throw Error('Repair branch readback identity mismatch');
  }
  if(entry.phase==='complete'){
    const pr=await github.findPR({
      repository:admission.repository,branch:admission.branch,base:'main'
    });
    if(!pr)return result(entry,admission,marker,'reconcile-required');
    if(!prVerified(pr,admission,marker)||pr.number!==entry.prNumber)
      throw Error('Repair PR readback identity mismatch');
    return result(entry,admission,marker,'complete');
  }

  if(entry.phase==='reserved'){
    // An existing unclaimed branch is not proof that this Repair App created it.
    // Such an object must never be silently adopted.
    const foreign=await github.getBranch({repository:admission.repository,branch:admission.branch});
    if(foreign)throw Error('Repair preexisting branch ownership unknown');
    await stepGate('branch.create');
    if(await ledger.advance({key,fingerprint,from:'reserved',to:'branch-dispatch'})){
      try{
        await github.createBranch({repository:admission.repository,branch:admission.branch,
          baseSha:admission.baseSha});
      }catch{
        // A write might have committed before its response was lost.
        // Resolve by immutable exact-object readback below; never re-dispatch.
      }
    }
    entry=await reRead();
  }

  if(entry.phase==='branch-dispatch'){
    const observed=await github.getBranch({repository:admission.repository,branch:admission.branch});
    if(!observed)
      return result(entry,admission,marker,'reconcile-required');
    if(!branchVerified(observed,admission))
      throw Error('Repair branch readback identity mismatch');
    await ledger.advance({key,fingerprint,from:'branch-dispatch',to:'branch-confirmed'});
    entry=await reRead();
  }
  if(entry.phase==='branch-confirmed'){
    // A PR not associated with a prior dispatch cannot be adopted.
    const foreign=await github.findPR({repository:admission.repository,branch:admission.branch,base:'main'});
    if(foreign)throw Error('Repair preexisting PR ownership unknown');
    await stepGate('pr.create');
    if(await ledger.advance({key,fingerprint,from:'branch-confirmed',to:'pr-dispatch'})){
      try{
        await github.createPR({repository:admission.repository,
          branch:admission.branch,base:'main',draft:false,
          title:titleFor(admission),body:marker+'\n\nObjective: '+admission.objective});
      }catch{
        // Unknown write; only exact PR readback can authorize completion.
      }
    }
    entry=await reRead();
  }
  if(entry.phase==='pr-dispatch'){
    const observed=await github.findPR({repository:admission.repository,branch:admission.branch,base:'main'});
    if(!observed)return result(entry,admission,marker,'reconcile-required');
    if(!prVerified(observed,admission,marker))
      throw Error('Repair PR readback identity mismatch');
    await ledger.advance({key,fingerprint,from:'pr-dispatch',to:'complete',prNumber:observed.number});
    entry=await reRead();
  }
  return result(entry,admission,marker,
    entry.phase==='complete'?'complete':'reconcile-required');
}
