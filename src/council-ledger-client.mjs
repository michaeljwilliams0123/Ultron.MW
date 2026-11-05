/** C04 ledger-guarded execution (outbox pattern).
 * Reserve BEFORE any external write; compare-and-set to `dispatched` before the
 * write; settle only from observed evidence. A duplicate, retried or
 * interrupted request recovers by readback and never re-sends a write that may
 * already have landed. Fails closed when the ledger is unreachable.
 */
const TERMINAL=new Set(['verified','executed','failed','planned']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/** transport(body) -> {status,body}; throws on network failure. */
export function createLedgerClient(transport){
 return Object.freeze({
  reserve:async input=>{
   const r=await transport({op:'reserve',...input});
   if(r.status!==200||!r.body?.ok)throw Error('ledger-reserve-failed:'+(r.body?.error||r.status));
   return r.body;
  },
  transition:async(key,from,to,detail={})=>{
   const r=await transport({op:'transition',key,from,to,detail});
   if(r.status===200&&r.body?.ok)return{ok:true,record:r.body.record};
   if(r.status===409)return{ok:false,conflict:true,record:r.body?.record||null,error:r.body?.error};
   throw Error('ledger-transition-failed:'+(r.body?.error||r.status));
  },
  read:async key=>{
   const r=await transport({op:'read',key});
   return r.status===200?r.body.record:null;
  }
 });
}

async function settle(ledger,record,outcome,{retries=3,delayMs=250}={}){
 let from=record.state,lastError;
 for(let i=0;i<retries;i++){
  try{
   const r=await ledger.transition(record.key,from,outcome.to,outcome.detail);
   if(r.ok)return{ok:true,record:r.record};
   if(r.record&&TERMINAL.has(r.record.state))return{ok:true,record:r.record,raced:true};
   if(r.record&&r.record.state!==from){from=r.record.state;continue;}
   return{ok:false,record:r.record,error:r.error};
  }catch(e){lastError=e;await sleep(delayMs*(i+1));}
 }
 return{ok:false,error:String(lastError?.message||'ledger-unavailable').slice(0,120)};
}

function evidenceOutcome(found){
 if(found.receipt)return{to:'verified',detail:{receipt:found.receipt}};
 return{to:'executed',detail:{executor:found.executor||'unattributed',url:found.url}};
}

/**
 * execute() -> action result {status,receipt?,effect?}; probe() -> evidence or null
 * where evidence is {receipt?|executor,url} proving the write exists (readback).
 */
export async function runLedgeredAction({ledger,intent,execute,probe=async()=>null,sleepMs=250}){
 let reserved;
 try{reserved=await ledger.reserve(intent);}
 catch(e){return{op:intent.operation,status:'blocked',reason:'ledger-unavailable',detail:String(e.message).slice(0,120)};}
 const record=reserved.record;
 if(TERMINAL.has(record.state)){
  return{op:intent.operation,status:record.state==='planned'?'planned':'duplicate',
   ledgerState:record.state,executionKey:record.key,skipped:true,
   reason:record.state==='planned'?'external-adapter-not-executed':'already-'+record.state};
 }
 if(record.state==='dispatched'||record.state==='reconcile-required'){
  let found=null;
  try{found=await probe();}catch{found=null;}
  if(found){
   const s=await settle(ledger,record,evidenceOutcome(found),{delayMs:sleepMs});
   return{op:intent.operation,status:s.ok?'recovered':'ack-interrupted',
    ledgerState:s.record?.state||record.state,executionKey:record.key,skipped:true,reason:'effect-found-by-readback'};
  }
  if(record.state==='dispatched')
   await settle(ledger,record,{to:'reconcile-required',detail:{reason:'outcome-unknown'}},{delayMs:sleepMs});
  return{op:intent.operation,status:'reconcile-required',ledgerState:'reconcile-required',
   executionKey:record.key,skipped:true,reason:'prior-attempt-unverified-not-replayed'};
 }
 // state === 'reserved': we must win the CAS before touching the provider.
 let claim;
 try{claim=await ledger.transition(record.key,'reserved','dispatched');}
 catch(e){return{op:intent.operation,status:'blocked',reason:'ledger-unavailable',detail:String(e.message).slice(0,120)};}
 if(!claim.ok)return{op:intent.operation,status:'in-flight',executionKey:record.key,skipped:true,reason:'claimed-elsewhere'};

 let result;
 try{result=await execute();}
 catch(e){
  let found=null;
  try{found=await probe();}catch{found=null;}
  const outcome=found?evidenceOutcome(found):
   {to:'reconcile-required',detail:{reason:'write-outcome-unknown:'+String(e.message).slice(0,100)}};
  const s=await settle(ledger,claim.record,outcome,{delayMs:sleepMs});
  return{op:intent.operation,status:found?'recovered':'error',ledgerState:s.record?.state||'dispatched',
   executionKey:record.key,reason:String(e.message).slice(0,160)};
 }
 let outcome;
 if(result.status==='done'){
  if(result.receipt)outcome={to:'verified',detail:{receipt:result.receipt}};
  else outcome={to:'executed',detail:{executor:result.effect?.executor||'unattributed',
   url:result.effect?.url||intent.targetUrl||'unavailable'}};
 }else{
  outcome={to:'failed',detail:{reason:result.reason||result.status}};
 }
 const s=await settle(ledger,claim.record,outcome,{delayMs:sleepMs});
 return{...result,executionKey:record.key,ledgerState:s.ok?s.record.state:'dispatched',
  ...(s.ok?{}:{status:result.status==='done'?'ack-interrupted':result.status,ackError:s.error})};
}
