/**
 * C02 bounded recovery of missing read/advisory hourly tasks. A late tick
 * may enqueue slots that the primary platform cron missed. These are NEW
 * recovery receipts; they never count as timely primary scheduler firings.
 * No provider write, credential, model invocation, or new cron is involved.
 */
const HOUR=3600000;
export async function recoverMissedHours({db,now=new Date(),lookbackHours=6}={}){
 if(typeof db?.query!=='function'||!(now instanceof Date)||
   !Number.isFinite(now.getTime())||!Number.isSafeInteger(lookbackHours)||
   lookbackHours<1||lookbackHours>6)throw Error('scheduler-recovery-input-invalid');
 const result=await db.query(`WITH slots AS (
   SELECT generate_series(
    date_trunc('hour',$1::timestamptz AT TIME ZONE 'UTC')
      - $2::integer * interval '1 hour',
    date_trunc('hour',$1::timestamptz AT TIME ZONE 'UTC')
      - interval '1 hour',interval '1 hour') AS slot_utc
 ), targets AS (
   SELECT CASE WHEN obj.objective='repo.inspect'
     THEN 'hourly-' ELSE 'council-hourly-' END ||
      to_char(slot_utc,'YYYYMMDDHH24') AS task_key,obj.objective
   FROM slots CROSS JOIN (VALUES ('repo.inspect'),('council.review')) AS obj(objective)
 ), moved AS (
   INSERT INTO brain_tasks(task_key,objective)
   SELECT task_key,objective FROM targets
   ON CONFLICT(task_key) DO NOTHING
   RETURNING id,task_key,objective
 ), receipts AS (
   INSERT INTO brain_events(task_id,event_type,details)
   SELECT id,'missed-hour-recovered',
      jsonb_build_object('objective',objective,
       'scheduledHour',right(task_key,10),
       'recovery','bounded-next-tick','paidCents',0)
   FROM moved RETURNING task_id
 ) SELECT (SELECT count(*)::integer FROM moved) AS recovered_count,
   (SELECT count(*)::integer FROM receipts) AS receipt_count`,
  [now.toISOString(),lookbackHours]);
 const row=result?.rows?.[0];
 if(!row||!Number.isSafeInteger(Number(row.recovered_count))||
    Number(row.recovered_count)!==Number(row.receipt_count))
   throw Error('scheduler-recovery-receipt-uncertain');
 const epoch=Math.floor(now.getTime()/HOUR)*HOUR;
 const key=millis=>new Date(millis).toISOString().slice(0,13).replace(/[^0-9]/g,'');
 return Object.freeze({recoveredCount:Number(row.recovered_count),
  windowHours:lookbackHours,oldestHour:key(epoch-lookbackHours*HOUR),
  newestHour:key(epoch-HOUR)});
}
