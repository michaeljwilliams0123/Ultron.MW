import { ALLOWED,CAPABILITIES } from 'lib/brain-core.js';
import { persistAcceptanceEvidence } from 'lib/acceptance-evidence.js';
const IDKEY=/^[a-z0-9-]{6,80}$/;
export async function queueObjective({db,scheduler},objective,key){
 if(!ALLOWED.has(objective))return {ok:false,error:'unsupported-objective'};
 if(key!=null && (typeof key!=='string'||!IDKEY.test(key)))return {ok:false,error:'invalid-idempotency-key'};
 const taskKey=key||('owner-'+crypto.randomUUID());
 const added=await db.query(`WITH admitted AS (
    INSERT INTO brain_tasks(task_key,objective) VALUES($1,$2)
    ON CONFLICT(task_key) DO NOTHING RETURNING id,task_key,objective,status
  ), receipt AS (
    INSERT INTO brain_events(task_id,event_type,details)
    SELECT id,'owner-queued',jsonb_build_object('objective',objective)
    FROM admitted RETURNING task_id
  ) SELECT id,task_key,objective,status FROM admitted`,[taskKey,objective]);
 const exists=added.rows[0]||(await db.query(
  "SELECT id,task_key,objective,status FROM brain_tasks WHERE task_key=$1",[taskKey])).rows[0];
 if(!exists)return {ok:false,error:'task-not-found-after-admission'};
 if(exists.objective!==objective)return {ok:false,error:'idempotency-key-conflict'};
 let scheduled=false;
 if(added.rows.length){
  try{await scheduler.now('/api/brain/run',{via:'owner'});scheduled=true;}
  catch(_e){scheduled=false;}
 }
 return {ok:true,task:exists,created:!!added.rows.length,immediate_scheduled:scheduled,scheduled_fallback:'hourly'};
}
export async function saveNote({db},kind,body){
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
 return {ok:true,note:r.rows[0]};
}
export async function controlTask({db},action,id){
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
 return {ok:true,task:r.rows[0]};
}
export async function admitAcceptanceEvidence({db},objectiveId,pullNumber){
 try{return await persistAcceptanceEvidence({db,objectiveId,
  candidatePullNumber:pullNumber});}
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
