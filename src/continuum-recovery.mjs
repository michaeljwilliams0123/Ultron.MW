/**
 * Continuum C02: bounded cloud recovery cycle over C01's durable outbox.
 *
 * This is an executable reconciliation adapter, NOT a second coordinator or
 * an external dispatch engine. It never replays a write, starts a worker,
 * invokes a model, changes credentials, or bypasses the C03 receiver gate.
 * The caller must supply authenticated PostgreSQL-backed control, due-queue,
 * and C01 outbox interfaces. No production scheduler is activated here.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const SHA=/^[a-f0-9]{40}$/;
const DELIVERY=/^[a-z0-9][a-z0-9_.:-]{11,127}$/i;
const WEEK_MS=7*24*60*60*1000;

function clock(value){
  const t=Date.parse(value);
  if(typeof value!=='string'||!Number.isFinite(t))
    throw Error('continuum-recovery-time-invalid');
  return new Date(t).toISOString();
}
function receipt(deliveryId,disposition){
  return Object.freeze({deliveryId,disposition,externalDispatches:0});
}
function summary(status,receipts=[]){
  return Object.freeze({schema:'ultron.continuum.recovery.v1',status,
    receipts:Object.freeze([...receipts]),externalDispatches:0,
    paidCents:0,paidFallback:false});
}

/**
 * A scheduled tick only observes persisted intentions. An expired pending
 * intent becomes reconcile-required under the exact source/lease fence.
 * An unknown response is a terminal HOLD for this pass, never a retry.
 */
export async function reconcileContinuumTick({
  outbox,listDue,readControl,now=new Date().toISOString(),limit=20
}={}){
  const observedAt=clock(now);
  if(typeof outbox?.observe!=='function'||
     typeof outbox?.markUnknown!=='function'||
     typeof listDue!=='function'||typeof readControl!=='function'||
     !Number.isSafeInteger(limit)||limit<1||limit>100)
    throw Error('continuum-recovery-input-invalid');
  const control=await readControl();
  if(control?.paused===true)return summary('paused');
  if(control?.paused!==false||control?.maxPaidCents!==0||
     control?.paidFallback!==false)
    return summary('held-zero-cost');
  const ids=await listDue({now:observedAt,limit});
  if(!Array.isArray(ids)||ids.length>limit||
     ids.some(id=>typeof id!=='string'||!DELIVERY.test(id))||
     new Set(ids).size!==ids.length)
    throw Error('continuum-recovery-queue-invalid');
  const receipts=[];
  for(const deliveryId of ids){
    try{
      const row=await outbox.observe({deliveryId});
      if(!row||row.deliveryId!==deliveryId||row.repository!==REPO||
         !SHA.test(row.sourceSha||'')||
         !Number.isSafeInteger(Number(row.leaseGeneration))||
         Number(row.leaseGeneration)<1||
         !['read','advisory'].includes(row.effect)||
         Number(row.maxPaidCents)!==0||
         !['pending','reconcile-required'].includes(row.state)){
        receipts.push(receipt(deliveryId,'held-unknown'));
        continue;
      }
      if(row.state==='reconcile-required'){
        receipts.push(receipt(deliveryId,'reconcile-required'));
        continue;
      }
      const expiry=Date.parse(row.expiresAt);
      if(!Number.isFinite(expiry)){
        receipts.push(receipt(deliveryId,'held-unknown'));
        continue;
      }
      if(expiry>Date.parse(observedAt)){
        receipts.push(receipt(deliveryId,'pending'));
        continue;
      }
      const result=await outbox.markUnknown({
        deliveryId,sourceSha:row.sourceSha,
        leaseGeneration:Number(row.leaseGeneration)
      });
      receipts.push(receipt(deliveryId,
        result?.state==='reconcile-required'?'reconcile-required':'held-unknown'));
    }catch{
      // A possible database transition may have committed before a lost ACK.
      // The next tick can only read back; never repeat an external effect.
      receipts.push(receipt(deliveryId,'held-unknown'));
    }
  }
  return summary(receipts.some(r=>r.disposition==='held-unknown')?
    'held-partial':'observed',receipts);
}

/**
 * SLO is derived from real scheduler receipts, never configured cron alone.
 * A missing slot is a failure, and duplicate observations cannot inflate
 * success. At least seven full days are required to certify the 99.5% goal.
 */
export function measureObservedSchedulerSlo({
  startAt,endAt,intervalMinutes=60,runs=[],target=0.995
}={}){
  const start=Date.parse(clock(startAt));
  const end=Date.parse(clock(endAt));
  if(!Number.isSafeInteger(intervalMinutes)||intervalMinutes<1||
     intervalMinutes>1440||typeof target!=='number'||target<=0||target>1||
     !Array.isArray(runs)||runs.length>10000)
    throw Error('continuum-slo-input-invalid');
  const interval=intervalMinutes*60000;
  const duration=end-start;
  if(duration<=0||duration%interval!==0||duration/interval>10000)
    throw Error('continuum-slo-window-invalid');
  const expectedSlots=duration/interval;
  const slots=new Map();
  for(const run of runs){
    const time=Date.parse(clock(run?.scheduledAt));
    if(time<start||time>=end||(time-start)%interval!==0)
      throw Error('continuum-slo-observation-invalid');
    const slot=(time-start)/interval;
    const good=run.source==='scheduler'&&run.success===true;
    slots.set(slot,(slots.get(slot)??true)&&good);
  }
  const observedSlots=slots.size;
  const successfulSlots=[...slots.values()].filter(Boolean).length;
  const successRate=successfulSlots/expectedSlots;
  const evidenceComplete=duration>=WEEK_MS&&observedSlots===expectedSlots;
  return Object.freeze({schema:'ultron.continuum.scheduler-slo.v1',
    expectedSlots,observedSlots,successfulSlots,
    missingSlots:expectedSlots-observedSlots,successRate,
    evidenceComplete,meetsTarget:evidenceComplete&&successRate>=target,
    paidCents:0});
}
