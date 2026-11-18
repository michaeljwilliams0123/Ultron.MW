/* Reconcile current natural hourly slots from independently persisted task
 * outcomes. This neither invokes the scheduler nor fabricates/adopts recovery
 * admissions. Historical slots outside the two-hour window are not rewritten.
 */
const REPO='michaeljwilliams0123/Ultron.MW';
const countOne=value=>Number(value)===1;

export function classifyTerminalSlotEvidence(row){
 if(!row||typeof row.slot_key!=='string')return null;
 if(row.classification!=='scheduled')return null;
 // Two distinct, exactly-once cron admissions must exist. A recovered/manual
 // event can never be upgraded to a natural scheduled admission.
 for(const field of ['repo_admissions','council_admissions',
  'authentic_repo_admissions','authentic_council_admissions']){
  if(!countOne(row[field]))return null;
 }
 if(row.repo_status==='blocked'||row.council_status==='blocked'){
  if(row.repo_status==='blocked'&&!countOne(row.terminal_repo_failure_receipts))return null;
  if(row.council_status==='blocked'&&!countOne(row.terminal_council_failure_receipts))return null;
  return 'failed';
 }
 if(row.repo_status!=='done'||row.council_status!=='done'||
  row.repo_source!=='github-api'||row.repo_repository!==REPO)return null;
 for(const field of ['observed_repo_receipts','observed_council_receipts',
  'council_assessments','free_council_assessments']){
  if(!countOne(row[field]))return null;
 }
 return 'done';
}

// This query is constrained to a freshly completed task and an already
// observed, pending, naturally picked-up slot. Readback is not backfill.
const CANDIDATE_SQL=`SELECT s.slot_key,s.classification,
 h.status AS repo_status,c.status AS council_status,
 h.last_result->>'source' AS repo_source,
 h.last_result->>'repository' AS repo_repository,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=h.id
   AND e.event_type='scheduled-hourly') AS repo_admissions,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=c.id
   AND e.event_type='scheduled-hourly') AS council_admissions,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=h.id
   AND e.event_type='scheduled-hourly' AND e.details->>'trigger'='cron'
   AND left(e.details->>'admittedAt',13)=left(s.slot_key,13)) AS authentic_repo_admissions,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=c.id
   AND e.event_type='scheduled-hourly' AND e.details->>'trigger'='cron'
   AND left(e.details->>'admittedAt',13)=left(s.slot_key,13)) AS authentic_council_admissions,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=h.id
   AND e.event_type='observed' AND e.details->>'source'='github-api') AS observed_repo_receipts,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=c.id
   AND e.event_type='observed') AS observed_council_receipts,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=h.id
  AND (e.event_type='attempt-limit'
    OR (e.event_type='failed' AND e.details->>'next_status'='blocked')))
    AS terminal_repo_failure_receipts,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=c.id
  AND (e.event_type='attempt-limit'
    OR (e.event_type='failed' AND e.details->>'next_status'='blocked')))
    AS terminal_council_failure_receipts,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=c.id
   AND e.event_type='council-assessment') AS council_assessments,
 (SELECT count(*)::int FROM brain_events e WHERE e.task_id=c.id
   AND e.event_type='council-assessment'
   AND e.details->>'creditCost'='0' AND e.details->>'paidFallback'='false'
   AND e.details->>'sourceSha'=h.last_result->>'sha') AS free_council_assessments
 FROM brain_scheduler_slots s
 JOIN brain_tasks h ON h.task_key='hourly-'||translate(left(s.slot_key,13),'-T','')
 JOIN brain_tasks c ON c.task_key='council-hourly-'||translate(left(s.slot_key,13),'-T','')
 WHERE s.completion_status='pending' AND s.classification='scheduled'
   AND s.actual_pickup_at >= now()-interval '2 hours'
   AND $1::bigint IN (h.id,c.id)
 ORDER BY s.slot_key DESC LIMIT 1`;

const TERMINAL_SQL=`UPDATE brain_scheduler_slots
 SET completion_status=$2,updated_at=now(),
 evidence=jsonb_build_object(
  'primaryOnTime',classification='scheduled' AND
    COALESCE((evidence->>'sloBreach')::boolean,true)=false AND $2='done',
  'sloBreach',classification<>'scheduled' OR
    COALESCE((evidence->>'sloBreach')::boolean,true) OR $2<>'done')
 WHERE slot_key=$1 AND completion_status='pending' RETURNING slot_key`;

export async function reconcileRecentNaturalSlots({db,outcomes=[]}={}){
 if(typeof db?.query!=='function'||!Array.isArray(outcomes))throw Error('invalid-reconciliation-input');
 let checked=0,completed=0,failed=0;
 const seen=new Set();
 for(const outcome of outcomes){
  if(!['done','failed'].includes(outcome?.status)||
   !['repo.inspect','council.review'].includes(outcome?.objective)||
   !Number.isSafeInteger(outcome.task_id)||seen.has(outcome.task_id))continue;
  seen.add(outcome.task_id);
  const candidate=await db.query(CANDIDATE_SQL,[outcome.task_id]);
  const slot=candidate.rows?.[0];
  if(!slot)continue;
  checked++;
  const status=classifyTerminalSlotEvidence(slot);
  if(status===null)continue;
  const updated=await db.query(TERMINAL_SQL,[slot.slot_key,status]);
  if(updated.rows?.length===1){if(status==='done')completed++;else failed++;}
 }
 return Object.freeze({checked,completed,failed});
}
