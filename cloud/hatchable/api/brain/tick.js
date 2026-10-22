import { db,browser,scheduler } from 'hatchable';
import { runOne } from 'lib/brain-runner.js';
export const access='scheduler';
export const methods=['POST'];
export default async function(req,res){
 const hour=new Date().toISOString().slice(0,13).replace(/[^0-9]/g,'');
 await db.query(`WITH admitted AS (
   INSERT INTO brain_tasks(task_key,objective) VALUES($1,'repo.inspect')
   ON CONFLICT(task_key) DO NOTHING RETURNING id
 ), receipt AS (
   INSERT INTO brain_events(task_id,event_type)
   SELECT id,'scheduled-hourly' FROM admitted RETURNING task_id
 ) SELECT id FROM admitted`,['hourly-'+hour]);
 const results=[];
 for(let i=0;i<4;i++){
  const result=await runOne({db,browser});
  results.push(result);
  if(result.status==='idle'||result.status==='lost-lease')break;
 }
 // Continue once through the existing scheduler endpoint, without recursive scheduling.
 const remaining=await db.query(`SELECT count(*)::int AS n FROM brain_tasks
  WHERE status='queued' AND attempts < max_attempts
  AND (lease_until IS NULL OR lease_until <= now())`);
 const pending=Number(remaining.rows[0]?.n||0);
 let continuation_scheduled=false;
 if(pending>0){
  try{await scheduler.now('/api/brain/run',{via:'hourly-backlog'});continuation_scheduled=true;}
  catch(_e){continuation_scheduled=false;}
 }
 return res.json({trigger:'hourly',processed:results.filter(r=>r.status==='done').length,
   pending,continuation_scheduled,results});
}
