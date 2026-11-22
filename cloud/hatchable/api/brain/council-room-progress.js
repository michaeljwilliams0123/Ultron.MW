import {db} from 'hatchable';

// A minimal owner-only terminal-state readback. No role result content,
// provider credentials, external calls, or task mutations are exposed.
export const access='admin';
export const methods=['GET'];
const ROOM=/^(?:owner-main|chat-[a-f0-9-]{36})$/;
function reply(res,code,body){
 res.setHeader('cache-control','private, no-store');
 return res.status(code).json({schema:'ultron.council-room-progress.v1',...body});
}
export default async function(req,res){
 if(req.member?.handle!=='michaeljwilliams0123')
  return reply(res,403,{ok:false,error:'owner-required'});
 if(req.method!=='GET')
  return reply(res,405,{ok:false,error:'method-not-allowed'});
 const raw=String(req.query?.taskId??'');
 const taskId=Number(raw);
 const room=String(req.query?.room||'owner-main');
 if(!/^[1-9][0-9]{0,15}$/.test(raw)||
    !Number.isSafeInteger(taskId)||!ROOM.test(room))
  return reply(res,400,{ok:false,error:'progress-request-invalid'});
 try{
  const sql='SELECT t.id,t.status,t.updated_at '+
   'FROM brain_tasks t '+
   'JOIN council_room_jobs j ON j.task_id=t.id '+
   'JOIN council_room_messages m ON m.id=j.message_id '+
   'WHERE t.id=$1 AND m.room_key=$2 '+
   "AND m.author_type='owner' AND m.author_id='michaeljwilliams0123' "+
   "AND t.objective='council.room' LIMIT 1";
  // Pass the validated decimal string `raw` (already checked as <= MAX_SAFE_INTEGER)
  // so PostgreSQL bigint receives an exact integer string without float64 coercion.
  const rows=(await db.query(sql,[raw,room])).rows;
  const row=rows[0];
  if(!row)return reply(res,404,{ok:false,error:'task-not-found'});
  const state=row.status==='leased'?'running':String(row.status||'unknown');
  return reply(res,200,{ok:true,taskId,state,
   terminal:['done','blocked','canceled','failed','error'].includes(state),
   updatedAt:row.updated_at});
 }catch{
  return reply(res,503,{ok:false,error:'progress-unavailable'});
 }
}
