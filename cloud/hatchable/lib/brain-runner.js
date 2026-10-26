import { executeObjective } from 'lib/brain-core.js';

// Each transition and its authoritative receipt must commit in ONE SQL statement.
// This prevents receipt/state divergence on interrupted database calls.
export async function runOne({db,browser,heartbeatIntervalMs=20_000}){
 if(!Number.isSafeInteger(heartbeatIntervalMs)||heartbeatIntervalMs<1||heartbeatIntervalMs>20_000)
  throw Error('invalid-heartbeat-interval');
 const recovered=await db.query(`WITH moved AS (
   UPDATE brain_tasks SET status='queued',owner_token=NULL,lease_until=NULL,updated_at=now()
   WHERE status='leased' AND lease_until < now() AND attempts < max_attempts RETURNING id
 ), receipt AS (
   INSERT INTO brain_events(task_id,event_type)
   SELECT id,'lease-recovered' FROM moved RETURNING task_id
 ) SELECT id FROM moved`);
 const blocked=await db.query(`WITH moved AS (
   UPDATE brain_tasks SET status='blocked',owner_token=NULL,lease_until=NULL,updated_at=now()
   WHERE status='leased' AND lease_until < now() AND attempts >= max_attempts RETURNING id
 ), receipt AS (
   INSERT INTO brain_events(task_id,event_type)
   SELECT id,'attempt-limit' FROM moved RETURNING task_id
 ) SELECT id FROM moved`);
 const token=crypto.randomUUID();
 const claim=await db.query(`WITH selected AS (
   SELECT id FROM brain_tasks
   WHERE status='queued' AND attempts < max_attempts
     AND (lease_until IS NULL OR lease_until <= now())
   ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
 ), moved AS (
   UPDATE brain_tasks SET status='leased',attempts=attempts+1,owner_token=$1,
     fencing_generation=fencing_generation+1,
     lease_until=now()+interval '90 seconds',updated_at=now()
   WHERE id IN (SELECT id FROM selected) RETURNING id,task_key,objective,attempts,fencing_generation
 ), receipt AS (
   INSERT INTO brain_events(task_id,event_type,details)
   SELECT id,'claimed',jsonb_build_object('objective',objective,'attempt',attempts)
   FROM moved RETURNING task_id
 ) SELECT id,task_key,objective,attempts,fencing_generation FROM moved`,[token]);
 const task=claim.rows[0];
 if(!task)return {status:'idle',recovered:recovered.rows.length,blocked:blocked.rows.length};

 // A 20-second renewable heartbeat prevents an active objective from being
 // reclaimed merely because the original 90-second lease elapsed.
 // Every heartbeat is fenced by BOTH the opaque token and monotonic generation.
 let heartbeatPending=null;
 let heartbeatLost=false;
 const pulse=()=>{
  if(heartbeatPending||heartbeatLost)return;
  heartbeatPending=db.query(`WITH moved AS (
    UPDATE brain_tasks SET lease_until=now()+interval '90 seconds',updated_at=now()
    WHERE id=$1 AND owner_token=$2 AND fencing_generation=$3
      AND status='leased' AND lease_until>now() RETURNING id
   ), receipt AS (
    INSERT INTO brain_events(task_id,event_type,details)
    SELECT id,'lease-heartbeat',jsonb_build_object('fencingGeneration',$3::bigint)
    FROM moved RETURNING task_id
   ) SELECT id FROM moved`,[task.id,token,task.fencing_generation])
   .then(r=>{if(r?.rows?.length!==1)heartbeatLost=true;})
   .catch(()=>{heartbeatLost=true;})
   .finally(()=>{heartbeatPending=null;});
 };
 const timer=setInterval(pulse,heartbeatIntervalMs);
 let result,executionError;
 try{
  // Future external-write objectives must still use a durable checkpoint and
  // provider-side preconditions; cooperative leases alone are not exactly-once.
  result=await executeObjective(task.objective,{db,browser,task:{
   id:task.id,taskKey:task.task_key,attempt:task.attempts,
   fencingGeneration:task.fencing_generation
  }});
 }catch(e){executionError=e;
 }finally{
  clearInterval(timer);
  if(heartbeatPending)await heartbeatPending;
 }
 if(heartbeatLost)return {status:'lost-lease',task_id:task.id,objective:task.objective};
 if(executionError){
  const e=executionError;
  const reason=String(e?.message||'execution-failed').replace(/[^a-z0-9-_]/gi,'-').slice(0,70);
  const failed=await db.query(`WITH moved AS (
    UPDATE brain_tasks SET
      status=CASE WHEN attempts>=max_attempts THEN 'blocked' ELSE 'queued' END,
      lease_until=CASE WHEN attempts>=max_attempts THEN NULL ELSE now()+interval '15 minutes' END,
      owner_token=NULL,updated_at=now()
    WHERE id=$1 AND owner_token=$2 AND status='leased' AND lease_until>now()
      AND fencing_generation=$4
    RETURNING id,objective,status
  ), receipt AS (
    INSERT INTO brain_events(task_id,event_type,details)
    SELECT id,'failed',jsonb_build_object('objective',objective,'reason',$3::text,'next_status',status)
    FROM moved RETURNING task_id
  ) SELECT id,status FROM moved`,[task.id,token,reason,task.fencing_generation]);
  if(failed.rows.length!==1)return {status:'lost-lease',task_id:task.id,objective:task.objective};
  return {status:'failed',task_id:task.id,objective:task.objective,reason,next_status:failed.rows[0].status};
 }
 try{
  const done=await db.query(`WITH moved AS (
    UPDATE brain_tasks SET status='done',last_result=$1::jsonb,owner_token=NULL,
      lease_until=NULL,updated_at=now()
    WHERE id=$2 AND owner_token=$3 AND status='leased' AND lease_until>now()
      AND fencing_generation=$6
    RETURNING id,objective
  ), receipt AS (
    INSERT INTO brain_events(task_id,event_type,details)
    SELECT id,'observed',jsonb_build_object('objective',objective,'source',$4::text)
    FROM moved RETURNING task_id
  ), assessments AS (
    INSERT INTO brain_events(task_id,event_type,details)
    SELECT moved.id,'council-assessment',item.value
    FROM moved CROSS JOIN LATERAL jsonb_array_elements($5::jsonb) AS item
    WHERE moved.objective='council.review' RETURNING task_id
  ) SELECT id FROM moved`,[JSON.stringify(result),task.id,token,result.source||'unknown',
   JSON.stringify(Array.isArray(result.assessment_receipts)?result.assessment_receipts:[]),
   task.fencing_generation]);
  if(done.rows.length!==1)return {status:'lost-lease',task_id:task.id,objective:task.objective};
  return {status:'done',task_id:task.id,objective:task.objective,summary:result};
 }catch(_error){
  // The completion query may have committed before the driver failed.
  // Never misclassify a successful objective as failed or immediately requeue it.
  // Only the existing lease-recovery path may revisit read-only objectives;
  // any future consequential write objective requires an external-action checkpoint.
  return {status:'completion-uncertain',task_id:task.id,objective:task.objective};
 }
}
