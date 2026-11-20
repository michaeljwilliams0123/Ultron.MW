/* Read-only audit: expected UTC cron slots versus durable observations.
 * Historical reconciliation never upgrades a slot to clean acceptance.
 */
const WINDOWS=new Set([24,168]);
const count=value=>{
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0)throw Error('invalid-scheduler-aggregate');
 return n;
};
const AUDIT_SQL=`WITH last_due AS (
 SELECT date_trunc('hour',timezone('UTC',now())-interval '17 minutes') AS hour_utc
), expected AS (
 SELECT generate_series((SELECT hour_utc FROM last_due)-($1::int-1)*interval '1 hour',
                        (SELECT hour_utc FROM last_due),interval '1 hour') AS hour_utc
), slots AS (
 SELECT s.slot_key,s.completion_status,s.evidence,s.pickup_lag_seconds,
        h.status AS repo_status,h.attempts AS repo_attempts,
        h.last_result->>'source' AS repo_source,
        c.status AS council_status,c.attempts AS council_attempts
 FROM expected e
 LEFT JOIN brain_scheduler_slots s
  ON s.slot_key=to_char(e.hour_utc,'YYYY-MM-DD"T"HH24:00"Z"')
 LEFT JOIN brain_tasks h
  ON h.task_key='hourly-'||translate(left(s.slot_key,13),'-T','')
 LEFT JOIN brain_tasks c
  ON c.task_key='council-hourly-'||translate(left(s.slot_key,13),'-T','')
)
SELECT count(*)::int AS expected_slots,
 count(slot_key)::int AS recorded_slots,
 count(*) FILTER(WHERE slot_key IS NULL)::int AS missing_slots,
 count(*) FILTER(WHERE completion_status='done')::int AS completed_slots,
 count(*) FILTER(WHERE completion_status='pending')::int AS pending_slots,
 count(*) FILTER(WHERE evidence->>'historicalReconciliation'='verified-terminal-receipts')::int AS historical_reconciled,
 count(*) FILTER(WHERE evidence->>'sloBreach'='true')::int AS pickup_slo_breaches,
 count(*) FILTER(WHERE completion_status='done'
   AND evidence->>'primaryOnTime'='true'
   AND NOT (COALESCE(evidence,'{}'::jsonb) ? 'historicalReconciliation')
   AND repo_status='done' AND council_status='done'
   AND repo_attempts=1 AND council_attempts=1
   AND repo_source='github-api')::int AS on_time_first_attempt_candidates
FROM slots`;

export async function readSchedulerAudit({db,windowHours}={}){
 if(typeof db?.query!=='function'||!WINDOWS.has(windowHours))
  throw Error('invalid-scheduler-audit-input');
 const result=await db.query(AUDIT_SQL,[windowHours]);
 if(result.rows?.length!==1)throw Error('scheduler-audit-unavailable');
 const r=result.rows[0];
 const audit=Object.freeze({windowHours,expectedSlots:count(r.expected_slots),
  recordedSlots:count(r.recorded_slots),missingSlots:count(r.missing_slots),
  completedSlots:count(r.completed_slots),pendingSlots:count(r.pending_slots),
  historicalReconciled:count(r.historical_reconciled),
  pickupSloBreaches:count(r.pickup_slo_breaches),
  onTimeFirstAttemptCandidates:count(r.on_time_first_attempt_candidates)});
 if(audit.recordedSlots+audit.missingSlots!==audit.expectedSlots||
    audit.onTimeFirstAttemptCandidates>audit.completedSlots)
  throw Error('scheduler-audit-inconsistent');
 return audit;
}
