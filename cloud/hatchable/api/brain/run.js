import { db,browser,scheduler,config,events } from 'hatchable';
import {notifyOwner} from 'lib/owner-live-events.js';
import { runOne } from 'lib/brain-runner.js';
import { readOwnerProfile } from 'lib/owner-autonomy-control.js';
import { resumePendingMahoragaActions } from 'lib/mahoraga-actions.js';
export const access='scheduler';
export const methods=['POST'];
export default async function(req,res){
 const profile=await readOwnerProfile({db});
 // Each task remains independently admitted under the current locked profile.
 // This upper bound prevents untrusted configuration from creating unlimited
 // scheduler work in one invocation, while expanding the old fixed four.
 const batchLimit=Math.min(8,profile.limits.maxSteps);
 const results=[];
 for(let i=0;i<batchLimit;i++){
  const result=await runOne({db,browser});
  results.push(result);
  if(result.status==='idle'||result.status==='lost-lease'||result.status==='paused')break;
 }
 // Only the hourly scheduler can visit persisted Mahoraga actions. Owner
 // commands and read-only queue continuations cannot activate this lane.
 let mahoraga={scanned:0,observed:0,pending:0,outcomes:[]};
 if(req?.body?.via==='hourly-backlog') {
   try{mahoraga=await resumePendingMahoragaActions({db,config,limit:2});}
   catch {mahoraga={status:'reconcile-unavailable',scanned:0};}
 }
 let continuation_scheduled=false;
 if(results.length===batchLimit && req?.body?.via!=='bounded-continuation'){
  const remaining=await db.query(`SELECT count(*)::int AS n FROM brain_tasks
   WHERE (status='queued' AND attempts < max_attempts
    AND (lease_until IS NULL OR lease_until <= now()))
    OR (status='leased' AND lease_until < now())`);
  if(Number(remaining.rows[0]?.n||0)>0){
   try{await scheduler.now('/api/brain/run',{via:'bounded-continuation'});continuation_scheduled=true;}
   catch(_e){continuation_scheduled=false;}
  }
 }
 if(results.some(r=>['done','failed','lost-lease'].includes(r.status)))
  await notifyOwner(events,'task');
 return res.json({trigger:'owner-requested',count:results.filter(r=>r.status==='done').length,
  continuation_scheduled,mahoraga,results});
}
