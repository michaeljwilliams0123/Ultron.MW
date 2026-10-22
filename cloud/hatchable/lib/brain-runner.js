import { executeObjective } from 'lib/brain-core.js';
export async function runOne({db,browser}){
 const recovered=await db.query("UPDATE brain_tasks SET status='queued',owner_token=NULL,lease_until=NULL,updated_at=now() WHERE status='leased' AND lease_until < now() AND attempts < max_attempts RETURNING id");
 for(const t of recovered.rows)await db.query("INSERT INTO brain_events(task_id,event_type) VALUES($1,'lease-recovered')",[t.id]);
 const blocked=await db.query("UPDATE brain_tasks SET status='blocked',owner_token=NULL,lease_until=NULL,updated_at=now() WHERE status='leased' AND lease_until < now() AND attempts >= max_attempts RETURNING id");
 for(const t of blocked.rows)await db.query("INSERT INTO brain_events(task_id,event_type) VALUES($1,'attempt-limit')",[t.id]);
 const token=crypto.randomUUID();
 const claim=await db.query("UPDATE brain_tasks SET status='leased',attempts=attempts+1,owner_token=$1,lease_until=now()+interval '3 minutes',updated_at=now() WHERE id=(SELECT id FROM brain_tasks WHERE status='queued' AND attempts < max_attempts AND (lease_until IS NULL OR lease_until <= now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,objective,attempts",[token]);
 const task=claim.rows[0];
 if(!task)return {status:'idle',recovered:recovered.rows.length,blocked:blocked.rows.length};
 await db.query("INSERT INTO brain_events(task_id,event_type,details) VALUES($1,'claimed',$2::jsonb)",[task.id,JSON.stringify({objective:task.objective,attempt:task.attempts})]);
 try{
  const result=await executeObjective(task.objective,{db,browser});
  const done=await db.query("UPDATE brain_tasks SET status='done',last_result=$1::jsonb,owner_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$2 AND owner_token=$3 AND status='leased' AND lease_until>now() RETURNING id",[JSON.stringify(result),task.id,token]);
  if(done.rows.length!==1)throw Error('lease-not-owned');
  await db.query("INSERT INTO brain_events(task_id,event_type,details) VALUES($1,'observed',$2::jsonb)",[task.id,JSON.stringify({objective:task.objective,source:result.source})]);
  return {status:'done',task_id:task.id,objective:task.objective,summary:result};
 }catch(e){
  const reason=String(e?.message||'execution-failed').replace(/[^a-z0-9-_]/gi,'-').slice(0,70);
  await db.query("UPDATE brain_tasks SET status=CASE WHEN attempts>=max_attempts THEN 'blocked' ELSE 'queued' END,lease_until=CASE WHEN attempts>=max_attempts THEN NULL ELSE now()+interval '15 minutes' END,owner_token=NULL,updated_at=now() WHERE id=$1 AND owner_token=$2",[task.id,token]);
  await db.query("INSERT INTO brain_events(task_id,event_type,details) VALUES($1,'failed',$2::jsonb)",[task.id,JSON.stringify({objective:task.objective,reason})]);
  return {status:'failed',task_id:task.id,objective:task.objective,reason};
 }
}