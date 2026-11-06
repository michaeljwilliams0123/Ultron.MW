import { ALLOWED,CAPABILITIES } from 'lib/brain-core.js';
import {notifyOwner} from 'lib/owner-live-events.js';
import { persistAcceptanceEvidence } from 'lib/acceptance-evidence.js';
import { persistHeldOutEvidence } from 'lib/heldout-evidence.js';
const IDKEY=/^[a-z0-9-]{6,80}$/;
export async function readQueuedObjective({db},objective,key){
 if(!ALLOWED.has(objective))return {ok:false,error:'unsupported-objective'};
 if(typeof key!=='string'||!IDKEY.test(key))return {ok:false,error:'invalid-idempotency-key'};
 let observed;
 try{observed=await db.query(`SELECT t.id,t.task_key,t.objective,t.status,
   e.id AS receipt_id,e.details->>'objective' AS receipt_objective
  FROM brain_tasks t LEFT JOIN brain_events e
   ON e.task_id=t.id AND e.event_type='owner-queued'
  WHERE t.task_key=$1`,[key]);}
 catch{return {ok:false,error:'reconcile-required',task_key:key};}
 if(!Array.isArray(observed?.rows)||observed.rows.length!==1)
  return {ok:false,error:'reconcile-required',task_key:key};
 const exists=observed.rows[0];
 if(exists.objective!==objective)return {ok:false,error:'idempotency-key-conflict'};
 if(exists.task_key!==key||exists.id==null||
  exists.receipt_objective!==objective||exists.receipt_id==null)
  return {ok:false,error:'reconcile-required',task_key:key};
 const {receipt_id,receipt_objective,...task}=exists;
 return {ok:true,task,receipt_id};
}
export async function queueObjective({db,scheduler,events},objective,key){
 if(!ALLOWED.has(objective))return {ok:false,error:'unsupported-objective'};
 if(key!=null && (typeof key!=='string'||!IDKEY.test(key)))return {ok:false,error:'invalid-idempotency-key'};
 const taskKey=key||('owner-'+crypto.randomUUID());
 let added,writeFailed=false;
 try{added=await db.query(`WITH admitted AS (
    INSERT INTO brain_tasks(task_key,objective) VALUES($1,$2)
    ON CONFLICT(task_key) DO NOTHING RETURNING id,task_key,objective,status
  ), receipt AS (
    INSERT INTO brain_events(task_id,event_type,details)
    SELECT id,'owner-queued',jsonb_build_object('objective',objective)
    FROM admitted RETURNING id,task_id
  ) SELECT admitted.id,admitted.task_key,admitted.objective,admitted.status,
    receipt.id AS receipt_id FROM admitted JOIN receipt ON receipt.task_id=admitted.id`,
  [taskKey,objective]);}catch{writeFailed=true;}
 const observed=await readQueuedObjective({db},objective,taskKey);
 if(!observed.ok)return observed;
 if((!writeFailed&&(!Array.isArray(added?.rows)||added.rows.length>1))||
  (added?.rows?.length===1&&(added.rows[0].id!==observed.task.id||
    added.rows[0].receipt_id!==observed.receipt_id)))
  return {ok:false,error:'reconcile-required',task_key:taskKey};
 const created=!writeFailed&&added.rows.length===1;
 let scheduled=false;
 if(created){
  try{await scheduler.now('/api/brain/run',{via:'owner'});scheduled=true;}
  catch(_e){scheduled=false;}
 }
 if(created)await notifyOwner(events,'task',Number(observed.task.id));
 return {...observed,created,immediate_scheduled:scheduled,scheduled_fallback:'hourly'};
}
export async function saveNote({db,events},kind,body){
 if(!['goal','observation','decision'].includes(kind)||typeof body!=='string'||!body.trim()||body.trim().length>1200)return {ok:false,error:'invalid-note'};
 // The receipt deliberately excludes the private note content.
 const r=await db.query(`WITH created AS (
   INSERT INTO brain_notes(kind,body) VALUES($1,$2)
   RETURNING id,kind,body,created_at
 ), receipt AS (
   INSERT INTO brain_events(event_type,details)
   SELECT 'owner-note',jsonb_build_object('note_id',id,'kind',kind) FROM created
   RETURNING id
 ) SELECT id,kind,body,created_at FROM created`,[kind,body.trim()]);
 await notifyOwner(events,'note',Number(r.rows[0]?.id));
 return {ok:true,note:r.rows[0]};
}
export async function controlTask({db,events},action,id){
 if(!Number.isInteger(id)||id<=0||id>1000000000)return {ok:false,error:'invalid-task-id'};
 if(action!=='cancel'&&action!=='retry')return {ok:false,error:'unsupported-action'};
 const transition=action==='cancel'
  ? "status='canceled',owner_token=NULL,lease_until=NULL"
  : "status='queued',attempts=0,owner_token=NULL,lease_until=NULL";
 const eligibility=action==='cancel' ? "status IN ('queued','blocked')" : "status='blocked'";
 const event=action==='cancel'?'owner-cancel':'owner-retry';
 const r=await db.query(`WITH moved AS (
   UPDATE brain_tasks SET ${transition},updated_at=now()
   WHERE id=$1 AND ${eligibility} RETURNING id,status
 ), receipt AS (
   INSERT INTO brain_events(task_id,event_type)
   SELECT id,$2 FROM moved RETURNING task_id
 ) SELECT id,status FROM moved`,[id,event]);
 if(!r.rows.length)return {ok:false,error:'task-not-eligible'};
 await notifyOwner(events,'task',Number(r.rows[0]?.id));
 return {ok:true,task:r.rows[0]};
}
export async function admitAcceptanceEvidence({db},objectiveId,pullNumber){
 try{
  const reviewer=await persistAcceptanceEvidence({db,objectiveId,
   candidatePullNumber:pullNumber});
  const evaluation=await persistHeldOutEvidence({db,objectiveId,
   candidatePullNumber:pullNumber});
  return {ok:true,reviewer:reviewer.receipts,evaluation:evaluation.receipts};
 }
 catch(error){return {ok:false,error:String(error?.message||'acceptance-readback-failed')};}
}
export async function snapshot({db}){
 const [tasks,events,notes]=await Promise.all([
  db.query("SELECT id,task_key,objective,status,attempts,max_attempts,last_result,lease_until,updated_at FROM brain_tasks ORDER BY id DESC LIMIT 30"),
  db.query("SELECT id,task_id,event_type,details,created_at FROM brain_events ORDER BY id DESC LIMIT 40"),
  db.query("SELECT id,kind,body,created_at FROM brain_notes ORDER BY id DESC LIMIT 12")
 ]);
 return {schema:'ultron.cloud-brain.v2',mode:'native-read-and-owner-instructions',capabilities:CAPABILITIES,tasks:tasks.rows,events:events.rows,notes:notes.rows};
}
