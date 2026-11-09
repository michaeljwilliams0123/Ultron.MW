import { db,scheduler,events } from 'hatchable';
import {notifyOwner} from 'lib/owner-live-events.js';
export const access='scheduler';
export const methods=['POST'];
export default async function(req,res){
 const now=new Date();
 const hour=now.toISOString().slice(0,13).replace(/[^0-9]/g,'');
 // One durable admission per 6-hour UTC slot. If the boundary tick is late
 // or missed, the next hourly tick still admits that slot exactly once.
 const researchSlot=now.toISOString().slice(0,10).replace(/[^0-9]/g,'')+'-'+Math.floor(now.getUTCHours()/6);
 const admitted=await db.query(`WITH admitted AS (
   INSERT INTO brain_tasks(task_key,objective)
   VALUES($1,'repo.inspect'),($2,'council.review'),($3,'research.intake')
   ON CONFLICT(task_key) DO NOTHING RETURNING id,objective
 ), receipt AS (
   INSERT INTO brain_events(task_id,event_type,details)
   SELECT id,'scheduled-hourly',jsonb_build_object('objective',objective)
   FROM admitted RETURNING task_id
 ) SELECT id,objective FROM admitted`,['hourly-'+hour,'council-hourly-'+hour,'research-slot-'+researchSlot]);
 // A scheduled tick has a short fire budget. Queue only: browser renders and
 // bounded multi-task processing belong to /api/brain/run, never this tick.
 // Continue once through the existing scheduler endpoint, without recursion.
 const remaining=await db.query(`SELECT count(*)::int AS n FROM brain_tasks
  WHERE (status='queued' AND attempts < max_attempts
   AND (lease_until IS NULL OR lease_until <= now()))
   OR (status='leased' AND lease_until < now())`);
 const pending=Number(remaining.rows[0]?.n||0);
 // Only already-admitted external actions qualify. Their durable, separate
 // state machine forbids POST replay after the first sent transition.
 const external=await db.query(`SELECT count(*)::int AS n FROM mahoraga_actions
   WHERE state IN ('prepared','sent','uncertain')`);
 const mahoraga_pending=Number(external.rows[0]?.n||0);
 // Reconcile only already authenticated GitHub webhook receipts. A failed or
 // skipped immediate one-shot is recovered on the existing hourly schedule.
 const hf=await db.query(`SELECT count(*)::int AS n FROM hf_github_receipts
   WHERE state IN ('pending','retry') AND verification_attempts<3
    AND next_attempt_at<=now() AND lease_until<now()`);
 const hf_pending=Number(hf.rows[0]?.n||0);
 let hf_reconciliation_scheduled=false;
 if(hf_pending>0){
  try{
   await scheduler.now('/api/brain/hf-github-reconcile',{via:'hourly-recovery'});
   hf_reconciliation_scheduled=true;
  }catch{hf_reconciliation_scheduled=false;}
 }
 let continuation_scheduled=false;
 if(pending>0||mahoraga_pending>0){
  try{await scheduler.now('/api/brain/run',{via:'hourly-backlog'});continuation_scheduled=true;}
  catch(_e){continuation_scheduled=false;}
 }
 if(admitted.rows.length)await notifyOwner(events,'task',Number(admitted.rows[0].id));
 return res.json({trigger:'hourly',processed:0,scheduled_count:admitted.rows.length,pending,mahoraga_pending,
   continuation_scheduled,hf_pending,hf_reconciliation_scheduled,mode:'dispatch-only'});
}
