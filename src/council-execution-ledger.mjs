/** C04: execution lifecycle for Council actions (outbox pattern).
 * intent -> reserved -> dispatched -> verified | executed | failed | reconcile-required
 * (executed = effect observed but authorship unproven; never counted as independent)
 * Plan-only operations terminate as 'planned', never 'verified'. The recorded
 * executor is whatever GitHub's response proves, so github-actions[bot] is
 * stated truthfully until a role's own App authors the effect.
 * Pure state machine: no network, no credentials, no authority grants.
 */
import {createHash} from 'node:crypto';
import {COUNCIL_APP_ROLES,verifyCouncilExecutionReceipt} from './council-app-identities.mjs';

export const EXECUTION_STATES=Object.freeze([
 'intent','reserved','dispatched','verified','executed','failed','reconcile-required','planned'
]);
const TERMINAL=new Set(['verified','executed','failed','planned']);
const TRANSITIONS=Object.freeze({
 intent:['reserved','planned','failed'],
 reserved:['dispatched','failed'],
 dispatched:['verified','executed','failed','reconcile-required'],
 'reconcile-required':['verified','failed'],
 verified:[],failed:[],planned:[]
});
export const PLAN_ONLY_OPS=Object.freeze(['web.open','mahoraga.repo.inspect','mahoraga.task.prepare']);
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;

export function executionKey({role,operation,caseSha,sourceSha,ordinal=0}={}){
 if(!COUNCIL_APP_ROLES.includes(role)||typeof operation!=='string'||!operation||
   !SHA64.test(caseSha||'')||!SHA40.test(sourceSha||'')||!Number.isSafeInteger(ordinal)||ordinal<0)
  throw Error('council-execution-key-invalid');
 return createHash('sha256').update([role,operation,caseSha,sourceSha,ordinal].join('\n')).digest('hex');
}

export function recordIntent({role,operation,caseSha,sourceSha,ordinal=0,expectedEffect=''}={}){
 const key=executionKey({role,operation,caseSha,sourceSha,ordinal});
 return Object.freeze({
  key,role,operation,caseSha,sourceSha,
  expectedEffect:String(expectedEffect).slice(0,300),
  state:PLAN_ONLY_OPS.includes(operation)?'planned':'intent',
  history:Object.freeze([PLAN_ONLY_OPS.includes(operation)?'planned':'intent'])
 });
}

export function advance(record,next,detail={}){
 if(!record||!EXECUTION_STATES.includes(next))throw Error('council-execution-transition-invalid');
 if(TERMINAL.has(record.state)||!TRANSITIONS[record.state]?.includes(next))
  throw Error('council-execution-transition-invalid');
 const out={...record,state:next,history:Object.freeze([...record.history,next])};
 if(next==='verified'){
  const receipt=detail.receipt;
  // Verified requires provider readback bound to this exact intent.
  if(!verifyCouncilExecutionReceipt(receipt)||receipt.role!==record.role||
    receipt.operation!==record.operation||receipt.caseSha!==record.caseSha||
    receipt.sourceSha!==record.sourceSha)
   throw Error('council-execution-receipt-mismatch');
  out.receiptDigest=receipt.digest;
  out.receipt=receipt;
  out.executor=receipt.effect.author;
 }
 if(next==='failed'||next==='reconcile-required')
  out.reason=String(detail.reason||'unspecified').slice(0,200);
 return Object.freeze(out);
}

/** Truthful verification when GitHub's author is not the role's own App:
 * the effect is recorded as executed by that actor, without independence. */
export function recordUnattributedEffect(record,{executor,url}){
 const next=advance(advance(record,'reserved'),'dispatched');
 return Object.freeze({...advance(next,'reconcile-required',{reason:'executor-not-role-app'}),
  executor:String(executor||'unknown').slice(0,80),effectUrl:String(url||'').slice(0,300)});
}

/** After a crash, any non-terminal record is never assumed to have succeeded. */
export function recoverRecord(record,{providerHasEffect}){
 if(TERMINAL.has(record.state)||record.state==='reconcile-required')return record;
 if(record.state==='dispatched')
  return advance(record,'reconcile-required',{reason:providerHasEffect?'effect-found-unverified':'outcome-unknown'});
 return advance(record,'failed',{reason:'abandoned-before-dispatch'});
}

export function summarizeLedger(records){
 const list=Array.isArray(records)?records:[];
 const by=Object.fromEntries(EXECUTION_STATES.map(s=>[s,0]));
 for(const r of list)if(r&&by[r.state]!==undefined)by[r.state]++;
 return Object.freeze({total:list.length,byState:Object.freeze(by),
  openReconciliations:by['reconcile-required'],
  appAuthenticatedVerified:list.filter(r=>r.state==='verified'&&
   verifyCouncilExecutionReceipt(r.receipt)).length,
  // App-authenticated execution is provenance, not an independent review.
  independentlyVerified:list.filter(r=>r.state==='verified'&&
   verifyCouncilExecutionReceipt(r.receipt)&&r.receipt.claims.independentReview===true).length});
}
