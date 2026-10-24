import { db,browser,scheduler } from 'hatchable';
import { runOne } from 'lib/brain-runner.js';
export const access='scheduler';
export const methods=['POST'];
export default async function(req,res){
 const results=[];
 for(let i=0;i<4;i++){
  const result=await runOne({db,browser});
  results.push(result);
  if(result.status==='idle'||result.status==='lost-lease')break;
 }
 let continuation_scheduled=false;
 if(results.length===4 && req?.body?.via!=='bounded-continuation'){
  const remaining=await db.query(`SELECT count(*)::int AS n FROM brain_tasks
   WHERE (status='queued' AND attempts < max_attempts
    AND (lease_until IS NULL OR lease_until <= now()))
    OR (status='leased' AND lease_until < now())`);
  if(Number(remaining.rows[0]?.n||0)>0){
   try{await scheduler.now('/api/brain/run',{via:'bounded-continuation'});continuation_scheduled=true;}
   catch(_e){continuation_scheduled=false;}
  }
 }
 return res.json({trigger:'owner-requested',count:results.filter(r=>r.status==='done').length,
  continuation_scheduled,results});
}
