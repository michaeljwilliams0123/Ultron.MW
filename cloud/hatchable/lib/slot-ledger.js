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
 return Object.freeze({schema:'ultron.scheduler-slot.v1',slotKey:scheduledHour,declaredMinute,
  actualPickupAt:pickup===null?null:new Date(pickup).toISOString(),
  pickupLagSeconds:lag,classification,completionStatus,
  sloBreach:lag!==null&&lag>sloSeconds||classification==='missing',
  primaryOnTime:classification==='scheduled'&&completionStatus==='done'&&lag<=sloSeconds});
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
       pickup_lag_seconds IS NOT NULL AND pickup_lag_seconds<=900 AND $2='done',
     'sloBreach',classification<>'scheduled' OR pickup_lag_seconds IS NULL OR
       pickup_lag_seconds>900 OR $2<>'done'
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
