/* Scheduler slot evidence. No job execution: the existing hourly recovery worker
 * continues to own task admission. This module records what actually happened.
 */
const HOUR=3600000, SHA=/^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/;
const fail=msg=>{throw Error('scheduler-slot-'+msg)};
const instant=value=>{const n=new Date(value).getTime();if(!Number.isFinite(n))fail('invalid-time');return n};
export function slotKey(utcTime){
 const time=instant(utcTime);
 return new Date(Math.floor(time/HOUR)*HOUR).toISOString().slice(0,13)+':00Z';
}
export function classifySlot({scheduledHour,actualPickupAt=null,declaredMinute=17,recovery=false,
 completionStatus='pending',sloSeconds=900}={}){
 if(!SHA.test(scheduledHour||'')||slotKey(scheduledHour)!==scheduledHour||
  !Number.isSafeInteger(declaredMinute)||declaredMinute<0||declaredMinute>59||
  !Number.isSafeInteger(sloSeconds)||sloSeconds<0||
  !['pending','done','failed'].includes(completionStatus))fail('invalid-input');
 const intended=instant(scheduledHour)+declaredMinute*60000;
 const pickup=actualPickupAt==null?null:instant(actualPickupAt);
 const lag=pickup===null?null:Math.max(0,Math.ceil((pickup-intended)/1000));
 const classification=pickup===null?'missing':recovery?'recovery':'scheduled';
 const sloBreach=(lag!==null&&lag>sloSeconds)||classification!=='scheduled'||completionStatus==='failed';
 return Object.freeze({schema:'ultron.scheduler-slot.v1',slotKey:scheduledHour,declaredMinute,
  actualPickupAt:pickup===null?null:new Date(pickup).toISOString(),
  pickupLagSeconds:lag,classification,completionStatus,
  sloBreach,
  primaryOnTime:classification==='scheduled'&&completionStatus==='done'&&!sloBreach});
}
export async function recordSlot({db,slot}={}){
 if(typeof db?.query!=='function'||slot?.schema!=='ultron.scheduler-slot.v1')fail('invalid-input');
 const inserted=await db.query(
  'INSERT INTO brain_scheduler_slots(slot_key,declared_minute,actual_pickup_at,pickup_lag_seconds,classification,completion_status,evidence) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(slot_key) DO NOTHING RETURNING slot_key',
  [slot.slotKey,slot.declaredMinute,slot.actualPickupAt,slot.pickupLagSeconds,slot.classification,
   slot.completionStatus,JSON.stringify({sloBreach:slot.sloBreach,primaryOnTime:slot.primaryOnTime})]);
 if(inserted.rows.length)return Object.freeze({created:true,slotKey:slot.slotKey});
 const existing=await db.query('SELECT slot_key,classification,completion_status FROM brain_scheduler_slots WHERE slot_key=$1',[slot.slotKey]);
 return Object.freeze({created:false,slotKey:slot.slotKey,
  existingClassification:existing.rows[0]?.classification??'unknown'});
}
export async function completeSlot({db,key,status}={}){
 if(typeof db?.query!=='function'||!SHA.test(key||'')||!['done','failed'].includes(status))
  fail('invalid-input');
 const result=await db.query(
  `UPDATE brain_scheduler_slots SET completion_status=$2,updated_at=now(),
   evidence=jsonb_build_object(
     'primaryOnTime',classification='scheduled' AND
       COALESCE((evidence->>'sloBreach')::boolean,true)=false AND $2='done',
     'sloBreach',classification<>'scheduled' OR
       COALESCE((evidence->>'sloBreach')::boolean,true) OR $2<>'done'
   ) WHERE slot_key=$1 AND completion_status=$3 RETURNING slot_key`,
  [key,status,'pending']);
 return Object.freeze({updated:result.rows.length===1,slotKey:key});
}
export function planRecovery({now,existingKeys=[],lookbackHours=6}={}){
 if(!Number.isSafeInteger(lookbackHours)||lookbackHours<1||lookbackHours>6||
  !Array.isArray(existingKeys))fail('invalid-input');
 const current=Math.floor(instant(now)/HOUR)*HOUR;
 const known=new Set(existingKeys);
 return Object.freeze(Array.from({length:lookbackHours},(_,i)=>slotKey(current-(i+1)*HOUR))
  .filter(key=>!known.has(key)).reverse());
}

/**
 * #184 terminal reconciliation is deliberately separate from cron pickup.
 * A 200 tick and a done task row without its durable observed event cannot
 * attest that the hourly slot completed. Failed slots require terminal
 * blocking evidence; queued/leased work is never marked failed prematurely.
 * This routine never schedules work, retries provider mutations or opens a
 * second coordinator.
 */
export async function reconcileSchedulerSlots({db,now=new Date().toISOString(),limit=48}={}){
 if(typeof db?.query!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>168)
  fail('invalid-input');
 const cutoff=slotKey(new Date(instant(now)-HOUR).toISOString());
 const result=await db.query(`
  SELECT s.slot_key,
   inspect.status AS inspect_status,council.status AS council_status,
   EXISTS(SELECT 1 FROM brain_events e
     WHERE e.task_id=inspect.id AND e.event_type='observed') AS inspect_observed,
   EXISTS(SELECT 1 FROM brain_events e
     WHERE e.task_id=council.id AND e.event_type='observed') AS council_observed,
   EXISTS(SELECT 1 FROM brain_events e
     WHERE e.task_id=inspect.id AND e.event_type IN ('attempt-limit','failed'))
     AS inspect_failed_receipt,
   EXISTS(SELECT 1 FROM brain_events e
     WHERE e.task_id=council.id AND e.event_type IN ('attempt-limit','failed'))
     AS council_failed_receipt
  FROM brain_scheduler_slots s
  LEFT JOIN brain_tasks inspect ON inspect.task_key='hourly-'||
    regexp_replace(left(s.slot_key,13),'[^0-9]','','g')
  LEFT JOIN brain_tasks council ON council.task_key='council-hourly-'||
    regexp_replace(left(s.slot_key,13),'[^0-9]','','g')
  WHERE s.completion_status='pending' AND s.slot_key<=$1::text
  ORDER BY s.slot_key DESC LIMIT $2::integer`,[cutoff,limit]);
 if(!Array.isArray(result?.rows))fail('terminal-readback-unavailable');
 let completed=0,failed=0;
 for(const row of result.rows){
  let status=null;
  if(row.inspect_status==='done'&&row.council_status==='done'&&
     row.inspect_observed===true&&row.council_observed===true)
   status='done';
  else if((row.inspect_status==='blocked'&&row.inspect_failed_receipt===true)||
          (row.council_status==='blocked'&&row.council_failed_receipt===true))
   status='failed';
  if(status!==null){
   const updated=await completeSlot({db,key:row.slot_key,status});
   if(updated.updated){if(status==='done')completed++;else failed++;}
  }
 }
 return Object.freeze({examined:result.rows.length,completed,failed,
  pending:result.rows.length-completed-failed});
}
